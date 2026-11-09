// Exercise the installed Paseo client's real registration validator, not a permissive mock.
import { build } from "esbuild";
import { readFile, readdir, realpath, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, join, delimiter } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
let webDir = process.env.PASEO_WEB_BUNDLE_DIR;
if (!webDir) {
 for (const directory of (process.env.PATH || "").split(delimiter)) {
  const cli = join(directory, "paseo");
  try { await access(cli); } catch { continue; }
  webDir = resolve(dirname(await realpath(cli)), "../node_modules/@getpaseo/server/dist/server/web-ui/_expo/static/js/web");
  break;
 }
}
assert(webDir, "Install Paseo CLI or set PASEO_WEB_BUNDLE_DIR to its web-ui/_expo/static/js/web directory");
const names = (await readdir(webDir)).filter((name) => /^index-.*\.js$/.test(name));
let runtimeSource;
for (const name of names) {
 const source = await readFile(join(webDir, name), "utf8");
 runtimeSource = source.split("\n").find((line) => /\.runPluginClientBundle=function/.test(line));
 if (runtimeSource) break;
}
assert(runtimeSource, "The installed client registration runtime was not found");
const React = require("react");
const native = { Platform: { OS: "web" }, StyleSheet: { create: (styles) => styles, hairlineWidth: 1 }, Text: () => null, View: () => null };
const ui = { Icon: () => null, useRevealedText: (text) => text };
const modules = [ { requirePluginText: (text) => text }, {}, ui, ui, {}, require("@getpaseo/plugin"), {}, React, require("react/jsx-runtime"), native, require("@tanstack/react-query"), require("zod"), { parsePluginIcon: (_, icon) => icon }, {} ];
const exported = {};
vm.runInNewContext(runtimeSource, { console, __d(factory, id, dependencies) { factory({}, (key) => modules[dependencies.indexOf(key)], null, null, { exports: exported }, exported, dependencies); } });
const built = await build({ absWorkingDir: root, entryPoints: ["client/genui/contribute.tsx"], bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, external: ["@getpaseo/plugin", "@getpaseo/plugin/*", "react", "react/*", "react-native", "@tanstack/react-query", "zod"] });
const source = `(function(require){ const module = {exports:{}}; const exports = module.exports; ${built.outputFiles[0].text}; return module.exports; })`;
const loaded = exported.runPluginClientBundle("paseo-hq", source, { playAudio: async () => {}, paseo: {} });
assert(loaded.timelineRenderers.some((entry) => entry.kind === "genui-block"));
assert(loaded.surfaces.some((entry) => entry.id === "gallery"));
assert.deepEqual(Array.from(loaded.clientSlashCommands, (entry) => entry.name), ["genui", "genui-demo", "genui-gallery"]);
await loaded.cleanup();
console.log("Installed Paseo client accepted Genui's renderers, gallery, settings and commands");
