import { describe, expect, it } from "vitest";
import { createGeminiLiveReader, mapGeminiQuotaPages } from "./gemini-live.server";
import { configureGeminiApi, readGeminiApiConfig, readGeminiApiUsage } from "./gemini-api.server";
import { GeminiApiConfigSchema } from "../shared/gemini-api.shared";
import { GEMINI_HELP_MARKDOWN } from "../shared/gemini-help.shared";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = GeminiApiConfigSchema.parse({ projectId: "example-project", projectNumber: "123456789", projectLabel: "Example", auth: "antigravity", quotaTier: "free", models: ["gemini-3.8-flash-tts", "unknown-model"] });
// Same protobuf JSON shape returned by Service Usage, stripped of project identifiers.
const metric = (suffix: string, unit: string, limit?: string) => ({ metric: `generativelanguage.googleapis.com/generate_content_free_tier_${suffix}`, consumerQuotaLimits: [{ unit, quotaBuckets: [{ dimensions: { model: "gemini-3.8-flash-tts" }, ...(limit === undefined ? {} : { effectiveLimit: limit }) }] }] });
const page = { metrics: [metric("requests", "1/min/{project}/{model}", "3"), metric("requests", "1/d/{project}/{model}", "10"), metric("input_token_count", "1/min/{project}/{model}", "10000")] };

describe("live Gemini project limits", () => {
  it("maps actual model ceilings without inventing usage or remaining quota", () => {
    const result = mapGeminiQuotaPages(config, [page], "2026-11-10T16:00:00Z");
    expect(result.source).toBe("google-cloud-live");
    expect(result.models[0]).toMatchObject({ rpm: { peak: null, limit: 3 }, tpm: { peak: null, limit: 10000 }, rpd: { peak: null, limit: 10 } });
    expect(result.models[1].rpm.limit).toBeNull();
  });
  it("distinguishes protobuf zero, unlimited and missing model bucket", () => {
    const result = mapGeminiQuotaPages(config, [{ metrics: [metric("requests", "1/min/{project}/{model}"), metric("requests", "1/d/{project}/{model}", "-1")] }], "2026-11-10T16:00:00Z");
    expect(result.models[0].rpm.limit).toBe(0);
    expect(result.models[0].rpd).toMatchObject({ limit: null, unlimited: true });
    expect(result.models[1].rpm.limit).toBeNull();
  });
  it("does not confuse per-user or paid quotas with the selected project pool", () => {
    expect(mapGeminiQuotaPages(config, [{ metrics: [metric("requests", "1/min/{project}/{user}/{model}", "90")] }], "2026-11-10T16:00:00Z").models[0].rpm.limit).toBeNull();
    expect(mapGeminiQuotaPages({ ...config, quotaTier: "paid" }, [page], "2026-11-10T16:00:00Z").models[0].rpm.limit).toBeNull();
  });
  it("reads every page, coalesces concurrent polls and preserves data age within TTL", async () => {
    let time = 100000; const requests: string[] = [];
    const read = createGeminiLiveReader({ now: () => time, getToken: async () => "test-only", fetchPage: async url => { requests.push(url); return url.includes("pageToken=next") ? page : { metrics: [], nextPageToken: "next" }; } });
    const [a, b] = await Promise.all([read(config), read(config)]);
    expect(a).toEqual(b); expect(requests).toHaveLength(2);
    time += 1000; expect((await read(config)).snapshot.capturedAt).toBe(a.snapshot.capturedAt);
    time += 61000; expect((await read(config)).snapshot.capturedAt).not.toBe(a.snapshot.capturedAt);
    expect(requests).toHaveLength(4);
  });
  it("rejects malformed or looping responses and does not mark them live", async () => {
    const read = createGeminiLiveReader({ now: Date.now, getToken: async () => "test-only", fetchPage: async () => ({ metrics: [], nextPageToken: "repeat" }) });
    await expect(read(config)).rejects.toThrow("слишком много страниц");
    expect(() => mapGeminiQuotaPages(config, [{ metrics: [metric("requests", "1/min/{project}/{model}", "-2")] }], "2026-11-10T16:00:00Z")).toThrow();
  });
  it("persists validated configuration privately and refuses silent snapshot fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gemini-live-test-"));
    try {
      await configureGeminiApi(config, directory);
      expect(await readGeminiApiConfig(directory)).toEqual(config);
      expect((await stat(join(directory, "gemini-api.json"))).mode & 0o777).toBe(0o600);
      await writeFile(join(directory, "gemini-api.json"), '{"secret":"PRIVATE"}');
      await expect(readGeminiApiUsage(directory)).rejects.toThrow("Неверный формат настроек");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("ships exactly the same guide used by agents and the UI", async () => {
    expect(await readFile(new URL("../docs/gemini-api.md", import.meta.url), "utf8")).toBe(GEMINI_HELP_MARKDOWN);
    expect(GEMINI_HELP_MARKDOWN).toContain("serviceusage.quotas.get");
    expect(GEMINI_HELP_MARKDOWN).toContain("Always use this billing account");
  });
});
