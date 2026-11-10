import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const output = process.env.LIMITS_SMOKE_OUTPUT || "/tmp/opencode/hq-gemini-api";
const live = process.argv.includes("--live");
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ["tests/limits/browser.tsx"],
  outfile: join(output, "browser.js"), bundle: true, platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
  alias: { "react-native": "react-native-web", "@getpaseo/plugin/client": resolve(root, "tests/limits/host.tsx") },
});

const pair = (peak, limit) => ({ peak, limit });
const fixture = {
  source: "ai-studio-snapshot", capturedAt: "2026-11-10T15:00:00Z",
  project: "Example project", tier: "free", periodDays: 28,
  models: [
    { id: "tts", label: "Gemini 3.8 Flash TTS", rpm: pair(4, 3), tpm: pair(545, 10000), rpd: pair(10, 10) },
    { id: "tts-lite", label: "Gemini 3.8 Flash Lite TTS", rpm: pair(4, 3), tpm: pair(49, 10000), rpd: pair(7, 10) },
    { id: "unknown", label: "Unknown quota model", rpm: pair(null, null), tpm: pair(0, null), rpd: pair(null, 10) },
  ],
};
let state = "snapshot";
let daemon;
if (live) {
  const { DaemonClient } = await import("@getpaseo/client/internal/daemon-client");
  daemon = new DaemonClient({ url: process.env.PASEO_DAEMON_URL || "ws://127.0.0.1:6767/ws",
    password: process.env.PASEO_PASSWORD, clientId: "hq-gemini-limits-smoke", clientType: "cli",
    appVersion: "0.15.2", reconnect: { enabled: false } });
  await daemon.connect();
}
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/rpc") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const { method, input } = JSON.parse(raw);
      assert.equal(method, "usage.gemini-api.read");
      if (state === "error") { response.writeHead(500); response.end("Неверный формат снимка Gemini API"); return; }
      const data = daemon ? await daemon.invokePluginRpc("paseo-hq", method, input)
        : { snapshot: state === "missing" ? null : fixture };
      await writeFile(join(output, live ? "rpc-live.json" : "rpc-fixture.json"), JSON.stringify(data, null, 2));
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(data));
    } else if (request.url === "/browser.js") {
      response.setHeader("Content-Type", "text/javascript"); response.end(await readFile(join(output, "browser.js")));
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px;box-sizing:border-box"><div id="root"></div><script src="/browser.js"></script></body></html>');
    }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
const results = [];
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const dirs = await readdir(join(homedir(), ".cache/ms-playwright"));
  const shell = dirs.filter(x => x.startsWith("chromium_headless_shell-")).sort().at(-1);
  browser = await chromium.launch(shell ? { executablePath: join(homedir(), ".cache/ms-playwright", shell, "chrome-headless-shell-linux64/chrome-headless-shell") } : {});
  for (const width of [390, 1280]) for (const mode of ["light", "dark"]) {
    state = "snapshot";
    const page = await browser.newPage({ viewport: { width, height: 1050 } });
    page.setDefaultTimeout(12000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?${mode}`);
    await page.getByText("Gemini 3.8 Flash TTS", { exact: true }).waitFor();
    await page.getByText("4 / 3", { exact: true }).first().waitFor();
    await page.getByText(/Пики за 28 дней, не текущий остаток/).waitFor();
    await page.getByText(/Автообновление Google не подключено/).waitFor();
    await page.getByRole("button", { name: /Все модели/ }).click();
    if (!live) await page.getByText("Unknown quota model", { exact: true }).waitFor();
    for (const [label, url] of [
      ["Живые лимиты", "https://aistudio.google.com/rate-limit"],
      ["Расход API", "https://aistudio.google.com/usage"],
      ["Биллинг", "https://aistudio.google.com/billing"],
      ["Кредиты Pro", "https://me.developers.google.com/benefits"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      assert.equal(await page.evaluate(() => document.body.dataset.opened), url);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "horizontal overflow");
    await page.screenshot({ path: join(output, `limits-${width}-${mode}${live ? "-live" : ""}.png`), fullPage: true });
    if (!live) {
      const captured = await page.getByText(/Снимок AI Studio от/).textContent();
      await page.getByRole("button", { name: "Перечитать снимок", exact: true }).click();
      await page.getByRole("button", { name: "Перечитать снимок", exact: true }).waitFor();
      assert.equal(await page.getByText(/Снимок AI Studio от/).textContent(), captured);
      state = "error";
      await page.getByRole("button", { name: "Перечитать снимок", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Неверный формат" }).waitFor();
      await page.getByText("4 / 3", { exact: true }).first().waitFor();
      state = "missing";
      await page.getByRole("button", { name: "Перечитать снимок", exact: true }).click();
      await page.getByText(/Статистика API пока не подключена/).waitFor();
      assert.equal(await page.getByText("4 / 3", { exact: true }).count(), 0);
    }
    assert.deepEqual(errors, []);
    results.push({ name: `${width}px ${mode}: ${live ? "installed RPC and real snapshot" : "peaks, links, refresh, stale error and missing data"}`, status: "passed" });
    await page.close();
  }
} catch (error) {
  results.push({ name: "Gemini API UI smoke", status: "failed", message: String(error.stack || error) });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await daemon?.close();
  await writeFile(join(output, live ? "ui-live-tests.json" : "ui-tests.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
