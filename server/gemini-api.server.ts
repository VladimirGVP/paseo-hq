import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createNodeConfigAdapters, usageConfigPath } from "./config.server";
import { GeminiApiSnapshotSchema } from "../shared/gemini-api.shared";

/** Never advance the producer's capturedAt just because the UI polled a file. */
export async function readGeminiApiUsage(
  directory = dirname(usageConfigPath(createNodeConfigAdapters())),
) {
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
