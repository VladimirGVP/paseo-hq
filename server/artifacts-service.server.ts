import { createHash, randomBytes } from "node:crypto";
import { execFile, exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readdir, readFile, stat, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { join, basename, extname } from "node:path";

export type ArtifactKind = "html" | "svg" | "markdown" | "code" | "data" | "file";

export interface StoredArtifact {
  id: string;
  name: string;
  title: string;
  kind: ArtifactKind;
  size: number;
  createdAt: string;
  projectDisplayName?: string;
  projectId?: string;
  workspaceId?: string;
  agentId?: string;
  sourceType: "chat_code" | "file_created" | "manual";
  yadiskUrl?: string;
  sha256?: string;
  telegramSent?: boolean;
  telegramSentAt?: string;
}

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export function getTelegramCredentials(): { botToken?: string; chatId?: string } {
  if (process.env.NODE_ENV === "test") return {};
  let botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN;
  let chatId = process.env.TELEGRAM_CHAT_ID || process.env.TG_CHAT_ID;
  if (botToken && chatId) return { botToken, chatId };

  const candidateFiles = [
    join(homedir(), ".paseo", "telegram.env"),
    join(homedir(), ".config", "paseo", "telegram.env"),
  ];

  for (const file of candidateFiles) {
    if (existsSync(file)) {
      try {
        const text = readFileSync(file, "utf8");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const [k, ...vParts] = trimmed.split("=");
          const key = k?.trim();
          const val = vParts.join("=").trim().replace(/^["']|["']$/g, "");
          if (["TELEGRAM_BOT_TOKEN", "TG_BOT_TOKEN", "BOT_TOKEN"].includes(key!) && !botToken) {
            botToken = val;
          }
          if (["TELEGRAM_CHAT_ID", "TG_CHAT_ID", "CHAT_ID"].includes(key!) && !chatId) {
            chatId = val;
          }
        }
        if (botToken && chatId) break;
      } catch {
        // ignore
      }
    }
  }

  return { botToken, chatId };
}

export const DEFAULT_ARTIFACTS_DIR =
  process.env.PASEO_ARTIFACTS_DIR || join(homedir(), ".paseo", "artifacts");

export interface ArtifactSaveInput {
  id?: string;
  name: string;
  title?: string;
  kind: ArtifactKind;
  content: string;
  projectId?: string;
  projectDisplayName?: string;
  workspaceId?: string;
  agentId?: string;
  sourceType?: "chat_code" | "file_created" | "manual";
}

export interface ArtifactListFilter {
  projectId?: string;
  workspaceId?: string;
  kind?: ArtifactKind;
  limit?: number;
}

export function sanitizeFileName(name: string): string {
  const parts = name.split(/[/\\]/);
  const base = (parts[parts.length - 1] ?? "artifact.txt").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "artifact.txt";
}

export function inferArtifactTitle(name: string, content: string, kind: ArtifactKind): string {
  if (kind === "html") {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    if (titleMatch?.[1]?.trim()) {
      return titleMatch[1].trim();
    }
    const h1Match = /<h1[^>]*>([^<]+)<\/h1>/i.exec(content);
    if (h1Match?.[1]?.trim()) {
      return h1Match[1].trim();
    }
  } else if (kind === "markdown") {
    const h1Match = /^#\s+(.+)$/m.exec(content);
    if (h1Match?.[1]?.trim()) {
      return h1Match[1].trim();
    }
  } else if (kind === "svg") {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    if (titleMatch?.[1]?.trim()) {
      return titleMatch[1].trim();
    }
  }
  return sanitizeFileName(name);
}



export class ArtifactsService {
  private readonly rootDir: string;
  private readonly filesDir: string;
  private readonly indexPath: string;
  private readonly deletedPath: string;

  constructor(rootDir: string = DEFAULT_ARTIFACTS_DIR) {
    this.rootDir = rootDir;
    this.filesDir = join(rootDir, "files");
    this.indexPath = join(rootDir, "index.json");
    this.deletedPath = join(rootDir, "deleted.json");
  }

  async loadDeletedHashes(): Promise<Set<string>> {
    try {
      const data = await readFile(this.deletedPath, "utf8");
      const list = JSON.parse(data) as string[];
      return new Set(list);
    } catch {
      return new Set();
    }
  }

  async recordDeletedHash(hash: string): Promise<void> {
    if (!hash) return;
    try {
      const set = await this.loadDeletedHashes();
      set.add(hash);
      const tmp = `${this.deletedPath}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(Array.from(set), null, 2), "utf8");
      await rename(tmp, this.deletedPath);
    } catch {
      // ignore
    }
  }

  async init(): Promise<void> {
    await mkdir(this.filesDir, { recursive: true });
    try {
      await stat(this.indexPath);
    } catch {
      await writeFile(this.indexPath, JSON.stringify([], null, 2), "utf8");
    }
  }

  private async loadIndex(): Promise<StoredArtifact[]> {
    try {
      const data = await readFile(this.indexPath, "utf8");
      return JSON.parse(data) as StoredArtifact[];
    } catch {
      return [];
    }
  }

  private async saveIndex(artifacts: StoredArtifact[]): Promise<void> {
    const tmp = `${this.indexPath}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(artifacts, null, 2), "utf8");
    await rename(tmp, this.indexPath);
  }

  async list(filter: ArtifactListFilter = {}): Promise<StoredArtifact[]> {
    await this.init();
    const all = await this.loadIndex();
    let filtered = all;

    if (filter.projectId) {
      filtered = filtered.filter((a) => a.projectId === filter.projectId);
    }
    if (filter.workspaceId) {
      filtered = filtered.filter((a) => a.workspaceId === filter.workspaceId);
    }
    if (filter.kind) {
      filtered = filtered.filter((a) => a.kind === filter.kind);
    }

    filtered.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

    if (filter.limit && filter.limit > 0) {
      filtered = filtered.slice(0, filter.limit);
    }
    return filtered;
  }

  async get(id: string): Promise<StoredArtifact | null> {
    const all = await this.loadIndex();
    return all.find((a) => a.id === id) ?? null;
  }

  async read(id: string): Promise<{ artifact: StoredArtifact; content: string } | null> {
    const artifact = await this.get(id);
    if (!artifact) return null;

    const filePath = join(this.filesDir, id, artifact.name);
    try {
      if (artifact.name.endsWith(".pdf") || artifact.kind === "file") {
        const buf = await readFile(filePath);
        const content = "data:application/pdf;base64," + buf.toString("base64");
        return { artifact, content };
      }
      const content = await readFile(filePath, "utf8");
      return { artifact, content };
    } catch {
      return null;
    }
  }

  async save(input: ArtifactSaveInput): Promise<StoredArtifact> {
    await this.init();
    const name = sanitizeFileName(input.name);
    const content = input.content;
    const isDataUri = content.startsWith("data:");
    const sha256 = isDataUri
      ? createHash("sha256").update(Buffer.from(content.slice(content.indexOf(",") + 1), "base64")).digest("hex")
      : createHash("sha256").update(content, "utf8").digest("hex");

    // Если артефакт ранее был явно удален пользователем, НЕ воскрешаем его в галерею
    const deletedHashes = await this.loadDeletedHashes();
    if (deletedHashes.has(sha256) && input.sourceType !== "manual") {
      return {
        id: `deleted_${sha256.slice(0, 16)}`,
        name,
        title: input.title?.trim() || inferArtifactTitle(name, isDataUri ? "" : content, input.kind),
        kind: input.kind,
        size: isDataUri
          ? Buffer.from(content.slice(content.indexOf(",") + 1), "base64").length
          : Buffer.byteLength(content, "utf8"),
        createdAt: new Date().toISOString(),
        sourceType: input.sourceType ?? "chat_code",
        sha256,
        telegramSent: true,
      };
    }

    const all = await this.loadIndex();
    const existing = all.find((a) => (input.id && a.id === input.id) || (a.sha256 === sha256 && a.name === name));
    if (existing) {
      let updated = false;
      if (!existing.projectId && input.projectId) {
        existing.projectId = input.projectId;
        updated = true;
      }
      if (!existing.workspaceId && input.workspaceId) {
        existing.workspaceId = input.workspaceId;
        updated = true;
      }
      if (!existing.projectDisplayName && input.projectDisplayName) {
        existing.projectDisplayName = input.projectDisplayName;
        updated = true;
      }
      if (updated) {
        await this.saveIndex(all);
      }
      return existing;
    }

    const id = input.id || `art_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const title = input.title?.trim() || inferArtifactTitle(name, isDataUri ? "" : content, input.kind);
    const size = isDataUri
      ? Buffer.from(content.slice(content.indexOf(",") + 1), "base64").length
      : Buffer.byteLength(content, "utf8");

    const itemDir = join(this.filesDir, id);
    await mkdir(itemDir, { recursive: true });
    const targetPath = join(itemDir, name);
    if (isDataUri) {
      const b64 = content.slice(content.indexOf(",") + 1);
      await writeFile(targetPath, Buffer.from(b64, "base64"));
    } else {
      await writeFile(targetPath, content, "utf8");
    }

    const artifact: StoredArtifact = {
      id,
      name,
      title,
      kind: input.kind,
      size,
      createdAt: new Date().toISOString(),
      projectDisplayName: input.projectDisplayName,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      sourceType: input.sourceType ?? "chat_code",
      sha256,
      telegramSent: false,
    };

    all.unshift(artifact);
    await this.saveIndex(all);

    // Автоматическая отправка в Telegram ТОЛЬКО для нового HTML из чата и только один раз, и НИКОГДА в тестах
    const isTest = process.env.NODE_ENV === "test";
    const { botToken, chatId } = getTelegramCredentials();
    if (
      !isTest &&
      artifact.kind === "html" &&
      artifact.sourceType === "chat_code" &&
      botToken &&
      chatId
    ) {
      void this.sendToTelegram(artifact.id, `HTML-артефакт: ${artifact.title || artifact.name}`).catch((err) => {
        console.warn("[artifacts] Auto-send HTML to Telegram error:", err);
      });
    }

    return artifact;
  }

  async uploadToYadisk(id: string): Promise<{ ok: boolean; yadiskUrl?: string; error?: string }> {
    const artifact = await this.get(id);
    if (!artifact) {
      return { ok: false, error: "Артефакт не найден" };
    }

    const filePath = join(this.filesDir, id, artifact.name);
    try {
      await stat(filePath);
    } catch {
      return { ok: false, error: "Файл артефакта отсутствует на диске" };
    }

    let uploadCmd = process.env.PASEO_CLOUD_UPLOAD_CMD;

    if (!uploadCmd) {
      return {
        ok: false,
        error: "Облачный экспорт не настроен. Задайте переменную PASEO_CLOUD_UPLOAD_CMD",
      };
    }

    let project = (artifact.projectId || "workspace").toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
    if (!/^[a-z0-9]/.test(project)) project = `p_${project}`;

    try {
      const cmd = uploadCmd
        .replace("{file}", `"${filePath}"`)
        .replace("{project}", `"${project}"`)
        .replace("{name}", `"${artifact.name}"`);

      const { stdout: linkOut } = await execAsync(cmd);
      const link = linkOut.trim().split("\n").filter(Boolean).pop();

      if (link && link.startsWith("http")) {
        artifact.yadiskUrl = link;
        const all = await this.loadIndex();
        const idx = all.findIndex((a) => a.id === id);
        if (idx >= 0) {
          all[idx].yadiskUrl = link;
          await this.saveIndex(all);
        }
        return { ok: true, yadiskUrl: link };
      }

      return { ok: true, yadiskUrl: undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async sendToTelegram(id: string, customCaption?: string): Promise<{ ok: boolean; error?: string }> {
    const artifact = await this.get(id);
    if (!artifact) {
      return { ok: false, error: "Артефакт не найден" };
    }

    const filePath = join(this.filesDir, id, artifact.name);
    try {
      await stat(filePath);
    } catch {
      return { ok: false, error: "Файл артефакта отсутствует на диске" };
    }

    const { botToken, chatId } = getTelegramCredentials();

    if (!botToken || !chatId) {
      return {
        ok: false,
        error: "Telegram не настроен. Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в переменных окружения или ~/.paseo/telegram.env",
      };
    }

    const caption = customCaption || `📄 ${artifact.title || artifact.name} (${artifact.name})`;

    try {
      const fileBuffer = await readFile(filePath);
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("caption", caption);
      formData.append("document", new Blob([fileBuffer]), artifact.name);

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        return { ok: false, error: `Ошибка Telegram API (${res.status}): ${errText}` };
      }

      artifact.telegramSent = true;
      artifact.telegramSentAt = new Date().toISOString();
      const all = await this.loadIndex();
      const idx = all.findIndex((a) => a.id === id);
      if (idx >= 0) {
        all[idx].telegramSent = true;
        all[idx].telegramSentAt = artifact.telegramSentAt;
        await this.saveIndex(all);
      }

      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async delete(id: string): Promise<boolean> {
    const all = await this.loadIndex();
    const target = all.find((a) => a.id === id);
    if (target?.sha256) {
      await this.recordDeletedHash(target.sha256);
    }
    const filtered = all.filter((a) => a.id !== id);
    if (filtered.length === all.length) return false;

    await this.saveIndex(filtered);
    const itemDir = join(this.filesDir, id);
    await rm(itemDir, { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  /**
   * Сканирует директорию на появление новых/измененных файлов за последний ход
   */
  async scanTurnFiles(
    cwd: string,
    meta: {
      agentId?: string;
      workspaceId?: string;
      projectId?: string;
      projectDisplayName?: string;
      maxAgeMs?: number;
    } = {},
  ): Promise<StoredArtifact[]> {
    const maxAgeMs = meta.maxAgeMs ?? 180_000;
    const now = Date.now();
    const discovered: StoredArtifact[] = [];

    const skipDirs = new Set([
      ".git",
      "node_modules",
      "dist",
      "build",
      ".next",
      "target",
      ".gemini",
      "coverage",
      ".cache",
      "tmp",
    ]);

    const walk = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 4) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) {
            await walk(join(dir, entry.name), depth + 1);
          }
          continue;
        }

        if (!entry.isFile()) continue;

        const ext = extname(entry.name).toLowerCase();
        const fullPath = join(dir, entry.name);
        try {
          const fileStat = await stat(fullPath);
          if (now - fileStat.mtimeMs > maxAgeMs) continue;
          if (fileStat.size === 0 || fileStat.size > 20 * 1024 * 1024) continue;

          let kind: ArtifactKind | null = null;
          if (ext === ".html" || ext === ".htm") kind = "html";
          else if (ext === ".svg") kind = "svg";
          else if (ext === ".pdf") kind = "file";
          else if (ext === ".md" && fileStat.size > 50) kind = "markdown";
          else if (dir.includes("artifacts") && (ext === ".json" || ext === ".csv")) {
            kind = "data";
          }

          if (!kind) continue;

          let content: string;
          let sha256: string;
          if (ext === ".pdf") {
            const buf = await readFile(fullPath);
            sha256 = createHash("sha256").update(buf).digest("hex");
            content = "data:application/pdf;base64," + buf.toString("base64");
          } else {
            content = await readFile(fullPath, "utf8");
            sha256 = createHash("sha256").update(content, "utf8").digest("hex");
          }

          // Проверяем, не сохранен ли уже этот артефакт
          const all = await this.loadIndex();
          if (all.some((a) => a.sha256 === sha256)) continue;

          const saved = await this.save({
            name: entry.name,
            kind,
            content,
            projectId: meta.projectId,
            projectDisplayName: meta.projectDisplayName,
            workspaceId: meta.workspaceId,
            agentId: meta.agentId,
            sourceType: "file_created",
          });
          discovered.push(saved);
        } catch {
          // Игнорируем ошибки чтения отдельных файлов
        }
      }
    };

    await walk(cwd);
    return discovered;
  }
}
