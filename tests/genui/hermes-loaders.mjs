// Runs the real file-loading hook in Hermes, where loop bindings differ from V8.
// Only React's hook scheduler and file RPC are supplied by this deterministic harness.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const executable = process.env.HERMES_EXECUTABLE;
assert(executable, "Set HERMES_EXECUTABLE to the Hermes CLI runtime (not hermesc)");
const root = resolve(import.meta.dirname, "../..");
const output = process.env.GENUI_SMOKE_OUTPUT || "/tmp/opencode/hq-genui";
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "hq-hermes-loaders-"));
const results = [];
const rpcSource = await readFile(join(root, "shared/genui/rpc.ts"), "utf8");
const rpcDescriptors = [...rpcSource.matchAll(/export const (\w+) = defineRpc\(\{\s*name: "([^"]+)"/g)].map(([, key, name]) => `export const ${key} = { name: "${name}" };`).join("\n");
const source = `
import { useLoadedData } from "./client/genui/loaders";
import { compile, evaluate } from "./shared/genui/core";
// The app supplies this ES2022 built-in on native too.
Object.hasOwn = Object.hasOwn || ((object, key) => Object.prototype.hasOwnProperty.call(object, key));
const program = compile('Card("Files", [Acceptance(Load("checks.json")), Draft(Load("message.txt"))])').program;
if (!program) throw Error("fixture did not compile");
useLoadedData({ agentId: "native-files" }, program);
globalThis.effects.forEach(effect => effect());
const checks = { ok: true, value: [{ name: "Native file check", status: "passed" }] };
const draft = { ok: true, value: "Exact provider draft" };
const complete = path => globalThis.pending[path].resolve(path === "checks.json" ? checks : draft);
const order = globalThis.reverse ? ["message.txt", "checks.json"] : ["checks.json", "message.txt"];
order.forEach(path => globalThis.rejectDraft && path === "message.txt" ? globalThis.pending[path].reject(Error("File RPC disconnected")) : complete(path));
Promise.all(globalThis.requests.map(request => request.catch(() => null))).then(() => {
  const rendered = evaluate(program, {}, globalThis.loaded);
  print(JSON.stringify({ files: Array.from(globalThis.loaded), rendered }));
});
`;
const hooks = `
globalThis.effects = [];
globalThis.pending = {};
globalThis.requests = [];
export const useMemo = fn => fn();
export const useCallback = fn => fn;
export const useRef = value => ({ current: value });
export const useState = init => { globalThis.loaded = init(); return [globalThis.loaded, update => { globalThis.loaded = update(globalThis.loaded); }]; };
export const useEffect = effect => { globalThis.effects.push(effect); };
export const useRpc = contract => input => {
  if (contract.name !== "genui.load_data") throw Error("Unexpected RPC " + contract.name);
  const promise = new Promise((resolve, reject) => { globalThis.pending[input.path] = { resolve, reject }; });
  globalThis.requests.push(promise);
  return promise;
};
`;
try {
  const built = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, sourcefile: "hermes-loader-fixture.ts" }, bundle: true, platform: "neutral", format: "iife", target: "es2020", supported: { "async-await": false }, write: false, plugins: [{ name: "host-hooks", setup(builder) {
    builder.onLoad({ filter: /shared[\\/]genui[\\/]rpc\.ts$/ }, () => ({ contents: rpcDescriptors, loader: "js" }));
    builder.onResolve({ filter: /^(react|@getpaseo\/plugin\/client)$/ }, args => ({ path: args.path, namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: hooks, loader: "js" }));
  }}] });
  for (const [name, reverse, rejectDraft] of [["JSON then text", false, false], ["Text then JSON", true, false], ["One file rejected", false, true]]) {
    const script = join(temporary, "fixture.js");
    await writeFile(script, `// CLI build lacks Intl; this fixture never formats a number or date.\nglobalThis.Intl = { NumberFormat: function() { this.format = String; }, DateTimeFormat: function() { this.format = String; } };\nglobalThis.reverse = ${reverse}; globalThis.rejectDraft = ${rejectDraft};\n${built.outputFiles[0].text}`);
    const actual = JSON.parse(execFileSync(executable, ["-Xintl", script], { encoding: "utf8" }));
    await writeFile(join(output, `hermes-${reverse ? "text-first" : "json-first"}-${rejectDraft ? "error" : "success"}.json`), JSON.stringify(actual, null, 2));
    const files = new Map(actual.files);
    assert.deepEqual(files.get("load:checks.json"), { ok: true, value: [{ name: "Native file check", status: "passed" }] });
    assert.deepEqual(files.get("load:message.txt"), rejectDraft ? { ok: false, error: "File RPC disconnected" } : { ok: true, value: "Exact provider draft" });
    assert.equal(actual.rendered.roots[0].type, "Card");
    assert.equal(actual.rendered.roots[0].props.children[0].type, "Acceptance");
    assert.equal(actual.rendered.roots[0].props.children[1].type, rejectDraft ? "Error" : "Draft");
    if (!rejectDraft) assert.deepEqual(actual.rendered.diagnostics, []);
    results.push({ name: `Hermes multiple Load: ${name}`, status: "passed" });
  }
} catch (error) {
  results.push({ name: "Hermes multiple Load", status: "failed", message: String(error.stack || error) });
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "hermes.json"), JSON.stringify(results, null, 2));
  await rm(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify(results));
