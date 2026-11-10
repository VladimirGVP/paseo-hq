import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createNodeConfigAdapters, usageConfigPath } from "./config.server";
import { GeminiApiSnapshotSchema, GeminiApiConfigSchema } from "../shared/gemini-api.shared";
import { readLiveGemini } from "./gemini-live.server";
import { GEMINI_HELP_MARKDOWN } from "../shared/gemini-help.shared";
import type { GeminiApiConfig } from "../shared/gemini-api.shared";

export async function geminiApiHelp() {
  return { markdown: GEMINI_HELP_MARKDOWN, config: await readGeminiApiConfig() };
}

export async function configureGeminiApi(input: GeminiApiConfig, directory = dirname(usageConfigPath(createNodeConfigAdapters()))) {
  const config = GeminiApiConfigSchema.parse(input);
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `.gemini-api-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, join(directory, "gemini-api.json"));
  return { saved: true as const };
}

export async function readGeminiApiConfig(directory = dirname(usageConfigPath(createNodeConfigAdapters()))) {
  let raw: string;
  try { raw = await readFile(join(directory, "gemini-api.json"), "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("Не удалось прочитать настройки Gemini API");
  }
  try { return GeminiApiConfigSchema.parse(JSON.parse(raw)); }
  catch { throw new Error("Неверный формат настроек Gemini API в gemini-api.json"); }
}

/** Never advance the producer's capturedAt just because the UI polled a file. */
export async function readGeminiApiUsage(
  directory = dirname(usageConfigPath(createNodeConfigAdapters())),
) {
  const config = await readGeminiApiConfig(directory);
  if (config) return readLiveGemini(config);
  let raw: string;
  try {
    raw = await readFile(join(directory, "gemini-api-usage.json"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { snapshot: null };
    }
    throw new Error("Не удалось прочитать снимок Gemini API");
  }
  let document: unknown;
  try { document = JSON.parse(raw); } catch {
    throw new Error("Неверный формат снимка Gemini API");
  }
  const result = GeminiApiSnapshotSchema.safeParse(document);
  if (!result.success) throw new Error("Неверный формат снимка Gemini API");
  return { snapshot: result.data };
}
