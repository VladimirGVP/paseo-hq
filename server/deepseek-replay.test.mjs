import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import ts from "typescript";

// Compile the actual provider module, including its non-erasable TS syntax.
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64");
const homeUrl = moduleUrl(await readFile(new URL("./deepseek/dsh-home.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("./deepseek/session-replay.ts", import.meta.url), "utf8"))
  .replace('from "./dsh-home"', `from "${homeUrl}"`);
const { buildSessionReplay } = await import(moduleUrl(source));

async function fixture(t, events) {
  const home = await mkdtemp(join(tmpdir(), "hq-replay-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const target = { sessionId: "old-session", cwd: "/example" };
  const directory = join(home, "sessions", "project", target.sessionId);
  await mkdir(directory, { recursive: true });
  const records = [{ type: "session", version: 4, id: target.sessionId, cwd: target.cwd },
    ...events.map((event, seq) => ({ seq, time: seq + 1, ...event }))];
  // Real DSH logs append independent zstd frames, rather than one compressed file.
  await writeFile(join(directory, "session.v4.jsonl.zstd"), Buffer.concat(records.map(record =>
    zstdCompressSync(Buffer.from(JSON.stringify(record) + "\n")))));
  return { home, replay: () => buildSessionReplay(target, { DSH_HOME: home }) };
}

const user = content => ({ type: "user/message", surfaceOp: "append", data: { id: "u1", source: { kind: "user" }, content } });
const answer = { type: "assistant/message", data: { message: { id: "a1", content: [{ type: "text", text: "Restored answer" }] } } };

for (const type of ["approval/asked", "approval/decided", "todo/write", "llm/retry", "llm/retry-started"]) {
  test(`old history survives ${type} and repeated restoration`, async t => {
    const { replay } = await fixture(t, [user([{ type: "text", text: "Original question" }]), { type, data: {} }, answer]);
    const first = await replay();
    assert.equal(first.failure, undefined);
    assert.deepEqual(first.frames.map(frame => frame.params.update.content.text), ["Original question", "Restored answer"]);
    assert.deepEqual(await replay(), first);
  });
}

test("old history restores image bytes and surrounding conversation", async t => {
  const bytes = Buffer.from("fixture image bytes");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const attachment = { attachmentId: `sha256:${digest}`, mediaType: "image/webp", bytes: bytes.length, width: 1, height: 1 };
  const { home, replay } = await fixture(t, [user([{ type: "text", text: "See image" }, { type: "image", attachment }]), answer]);
  const directory = join(home, "attachments", "v1", "objects", digest.slice(0, 2));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, digest), bytes);
  const first = await replay();
  assert.equal(first.failure, undefined);
  assert.deepEqual(first.frames.map(frame => frame.params.update.content), [
    { type: "text", text: "See image" },
    { type: "image", mimeType: "image/webp", data: bytes.toString("base64") },
    { type: "text", text: "Restored answer" },
  ]);
  assert.deepEqual(await replay(), first);
  await writeFile(join(directory, digest), Buffer.alloc(bytes.length));
  assert.equal((await replay()).failure, "corrupt");
});

test("unknown events still report unsupported instead of silently omitting history", async t => {
  const { replay } = await fixture(t, [answer, { type: "unknown/future-event", data: {} }]);
  assert.deepEqual(await replay(), { frames: [], failure: "unsupported" });
});

// Opt-in read-only check against existing DSH sessions; target metadata stays
// outside the repository. This never resumes an agent or contacts a model.
if (process.env.PASEO_REPLAY_CHECK_TARGETS) {
  const targets = JSON.parse(await readFile(process.env.PASEO_REPLAY_CHECK_TARGETS, "utf8"));
  for (const { sid, cwd } of targets) {
    test(`saved session ${sid} restores twice without warnings`, async () => {
      const first = await buildSessionReplay({ sessionId: sid, cwd }, process.env);
      assert.equal(first.failure, undefined);
      assert.ok(first.frames.length > 0, "restoration must recover conversation updates");
      assert.deepEqual(await buildSessionReplay({ sessionId: sid, cwd }, process.env), first);
    });
  }
}
