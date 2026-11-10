import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGeminiApiUsage } from "./gemini-api.server";

const report = {
  source: "ai-studio-snapshot",
  capturedAt: "2026-11-10T15:00:00Z",
  project: "Example project",
  tier: "free",
  periodDays: 28,
  models: [{
    id: "gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS",
    rpm: { peak: 4, limit: 3 }, tpm: { peak: 545, limit: 10000 },
    rpd: { peak: 10, limit: 10 },
  }],
};

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "gemini-limits-test-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("Gemini API limits snapshot", () => {
  it("missing source means unknown, with no fabricated zero quota", () => withDirectory(async directory => {
    expect(await readGeminiApiUsage(directory)).toEqual({ snapshot: null });
  }));
  it("preserves peak above limit and capture time when reread", () => withDirectory(async directory => {
    await writeFile(join(directory, "gemini-api-usage.json"), JSON.stringify(report));
    const first = await readGeminiApiUsage(directory);
    expect(first.snapshot).toEqual(report);
    expect((await readGeminiApiUsage(directory)).snapshot?.capturedAt).toBe(report.capturedAt);
  }));
  it("picks up replaced data instead of caching a screenshot indefinitely", () => withDirectory(async directory => {
    const file = join(directory, "gemini-api-usage.json");
    await writeFile(file, JSON.stringify(report));
    await readGeminiApiUsage(directory);
    await writeFile(file, JSON.stringify({ ...report, tier: "paid", models: [] }));
    expect((await readGeminiApiUsage(directory)).snapshot).toMatchObject({ tier: "paid", models: [] });
  }));
  it.each(["not-json PRIVATE_VALUE", JSON.stringify({ ...report, models: [{ ...report.models[0], rpm: { peak: -1, limit: 3 } }] }), JSON.stringify({ ...report, apiKey: "PRIVATE_VALUE" })])("rejects invalid data without exposing raw contents", invalid => withDirectory(async directory => {
    await writeFile(join(directory, "gemini-api-usage.json"), invalid);
    await expect(readGeminiApiUsage(directory)).rejects.toThrow("Неверный формат снимка Gemini API");
    try { await readGeminiApiUsage(directory); } catch (error) { expect(String(error)).not.toContain("PRIVATE_VALUE"); }
  }));
  it("does not hide a filesystem error as a missing source", () => withDirectory(async directory => {
    await mkdir(join(directory, "gemini-api-usage.json"));
    await expect(readGeminiApiUsage(directory)).rejects.toThrow("Не удалось прочитать снимок Gemini API");
  }));
});
