import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

function member(id, patch = {}) {
  return {
    id,
    kind: "human",
    name: `Член ${id}`,
    role: "",
    avatar: "🙂",
    hostServerId: null,
    agentId: null,
    provider: null,
    cwd: null,
    container: null,
    cgroupPath: null,
    activityPath: null,
    updatedAt: "2026-11-09T10:00:00.000Z",
    ...patch,
  };
}

function task(id, patch = {}) {
  return {
    id,
    title: `Задача ${id}`,
    description: "",
    status: "backlog",
    assigneeId: null,
    projectId: null,
    priority: 0,
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
    hostServerId: null,
    agentId: null,
    workspaceId: null,
    externalUrl: null,
    ...patch,
  };
}

test("репозиторий команды: подключение, сохранение, слияние двух клиентов", async () => {
  const root = await mkdtemp(join(tmpdir(), "hq-team-"));
  const bare = join(root, "team.git");
  process.env.PASEO_HQ_TEAM_DIR = join(root, "clone-a");
  process.env.PASEO_HQ_TEAM_CONFIG = join(root, "team.json");
  await exec("git", ["init", "--bare", "-q", bare]);

  try {
    const { connectRepo, saveBoard, syncBoard } = await import("../server/team.server.ts");

    const { repo, board } = await connectRepo(`file://${bare}`, "main");
    assert.equal(board.members.length, 0);
    assert.equal(repo.branch, "main");

    await saveBoard(repo, { version: 1, updatedAt: "", members: [member("m1")], tasks: [] });

    // Второй человек работает в своём клоне того же репозитория.
    const cloneB = join(root, "clone-b");
    await exec("git", ["clone", "-q", `file://${bare}`, cloneB]);
    const repoB = { url: `file://${bare}`, branch: "main", dir: cloneB };
    await saveBoard(repoB, { version: 1, updatedAt: "", members: [], tasks: [task("b", { assigneeId: "m1" })] });

    // Первый клиент досылает свою задачу: обе должны остаться.
    const merged = await saveBoard(repo, {
      version: 1,
      updatedAt: "",
      members: [member("m1")],
      tasks: [task("a")],
    });
    assert.deepEqual(merged.tasks.map((t) => t.id).sort(), ["a", "b"]);
    assert.equal(merged.members.length, 1);

    const synced = await syncBoard();
    assert.deepEqual(synced.tasks.map((t) => t.id).sort(), ["a", "b"]);

    // Проверяем, что файл действительно уехал в удалённый репозиторий.
    const check = join(root, "check");
    await exec("git", ["clone", "-q", "--branch", "main", `file://${bare}`, check]);
    const raw = JSON.parse(await readFile(join(check, "hq.json"), "utf8"));
    assert.equal(raw.members[0].id, "m1");
    assert.equal(raw.tasks.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
