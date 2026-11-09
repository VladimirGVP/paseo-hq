import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  EMPTY_BOARD,
  boardConfigSchema,
  boardDisplayName,
  mergeBoard,
  newId,
  parseBoard,
  type BoardConfig,
  type TeamBoard,
} from "../shared/team-model.ts";

const execFileAsync = promisify(execFile);

export const BOARD_FILE = "hq.json";
export const PENDING_FILE = "hq.pending.json";
const CONFIG_FILE =
  process.env.PASEO_HQ_TEAM_CONFIG || join(homedir(), ".local", "state", "paseo-hq", "team.json");
const BASE_DIR =
  process.env.PASEO_HQ_TEAM_DIR || join(homedir(), ".local", "state", "paseo-hq");

/** Как часто отправлять накопленные правки в git. */
export const FLUSH_INTERVAL_MS = 60_000;

let cachedConfigs: BoardConfig[] | null = null;

interface Draft {
  board: TeamBoard;
  removedTaskIds: Set<string>;
  removedMemberIds: Set<string>;
  dirty: boolean;
}

const drafts = new Map<string, Draft>();
let hydration: Promise<void> | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  return trimmed;
}

export function canonicalRepoKey(raw: string): string {
  const trimmed = normalizeUrl(raw);
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2].replace(/^\/+/, "")}`.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "file:") {
      return parsed.pathname.replace(/\.git\/?$/, "").replace(/\/+$/, "");
    }
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname.replace(/\.git\/?$/, "").replace(/^\/+/, "").replace(/\/+$/, "");
    return `${host}/${pathname}`.toLowerCase();
  } catch {
    return trimmed.replace(/\.git\/?$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

export function sameRepoUrl(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  return canonicalRepoKey(a) === canonicalRepoKey(b);
}

function errorText(err: unknown): string {
  const e = err as { stderr?: string; stdout?: string; message?: string };
  const text = [e?.stderr, e?.stdout, e?.message].filter(Boolean).join("\n").trim();
  return text.split("\n").slice(0, 4).join(" ").slice(0, 400) || "неизвестная ошибка git";
}

async function git(cwd: string, args: string[], timeout = 60000): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

async function isRepo(dir: string): Promise<boolean> {
  return stat(join(dir, ".git"))
    .then((s) => s.isDirectory() || s.isFile())
    .catch(() => false);
}

async function hasHead(dir: string): Promise<boolean> {
  try {
    await git(dir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function configureGit(dir: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("which", ["gh"]);
    if (stdout.trim()) {
      await git(dir, ["config", "credential.helper", "!gh auth git-credential"]).catch(() => undefined);
    }
  } catch {
    // gh нет - останется обычная авторизация git (ssh-ключи или helper)
  }
  try {
    await git(dir, ["config", "user.name"]);
  } catch {
    await git(dir, ["config", "user.name", "Paseo HQ"]).catch(() => undefined);
    await git(dir, ["config", "user.email", "paseo-hq@localhost"]).catch(() => undefined);
  }
}

async function remoteUrl(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ["remote", "get-url", "origin"])).trim();
  } catch {
    return null;
  }
}

export async function readConfigs(): Promise<BoardConfig[]> {
  if (cachedConfigs) return cachedConfigs;
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as { boards?: unknown };
    const boards = Array.isArray(raw?.boards)
      ? raw.boards
          .map((b) => boardConfigSchema.safeParse(b))
          .filter((r) => r.success)
          .map((r) => (r as { data: BoardConfig }).data)
      : [];
    cachedConfigs = boards;
  } catch {
    cachedConfigs = [];
  }
  return cachedConfigs;
}

export async function writeConfigs(boards: BoardConfig[]): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ boards }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, CONFIG_FILE);
  cachedConfigs = boards;
}

async function getConfig(boardId: string): Promise<BoardConfig | undefined> {
  const configs = await readConfigs();
  return configs.find((b) => b.id === boardId);
}

export async function ensureRepo(cfg: BoardConfig): Promise<void> {
  if (!(await isRepo(cfg.dir))) {
    await mkdir(dirname(cfg.dir), { recursive: true, mode: 0o700 });
    try {
      await execFileAsync("git", ["clone", "--", cfg.url, cfg.dir], {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch (err) {
      throw new Error(`не удалось склонировать репозиторий: ${errorText(err)}`);
    }
  } else {
    const origin = await remoteUrl(cfg.dir);
    if (origin && !sameRepoUrl(origin, cfg.url)) {
      throw new Error("к папке уже подключён другой репозиторий, сначала отключите текущую доску");
    }
  }

  await configureGit(cfg.dir);

  if (!(await hasHead(cfg.dir))) {
    const remoteBranch = await git(cfg.dir, ["rev-parse", "--verify", `refs/remotes/origin/${cfg.branch}`])
      .then(() => true)
      .catch(() => false);
    if (remoteBranch) {
      await git(cfg.dir, ["checkout", "-q", "-B", cfg.branch, `origin/${cfg.branch}`]);
    } else {
      await git(cfg.dir, ["symbolic-ref", "HEAD", `refs/heads/${cfg.branch}`]);
    }
    return;
  }

  const branchExists = await git(cfg.dir, ["rev-parse", "--verify", `refs/heads/${cfg.branch}`])
    .then(() => true)
    .catch(() => false);
  if (!branchExists) {
    await git(cfg.dir, ["checkout", "-q", "-b", cfg.branch]);
  } else {
    const current = (await git(cfg.dir, ["branch", "--show-current"])).trim();
    if (current !== cfg.branch) await git(cfg.dir, ["checkout", "-q", cfg.branch]);
  }
}

export async function pullRepo(cfg: BoardConfig): Promise<void> {
  await ensureRepo(cfg);
  if (!(await hasHead(cfg.dir))) return;
  try {
    await git(cfg.dir, ["pull", "--rebase", "--autostash", "origin", cfg.branch], 120000);
  } catch (err) {
    await git(cfg.dir, ["rebase", "--abort"]).catch(() => undefined);
    const text = errorText(err);
    if (/couldn't find remote ref|no such ref|not found/i.test(text)) return;
    throw new Error(`не удалось обновить доску: ${text}`);
  }
}

export async function readBoard(cfg: BoardConfig): Promise<TeamBoard> {
  try {
    const raw = await readFile(join(cfg.dir, BOARD_FILE), "utf8");
    return parseBoard(JSON.parse(raw));
  } catch {
    return { ...EMPTY_BOARD };
  }
}

function pendingPath(cfg: BoardConfig): string {
  return join(cfg.dir, PENDING_FILE);
}

interface PendingFile {
  board: TeamBoard;
  removedTaskIds: string[];
  removedMemberIds: string[];
}

async function readPending(cfg: BoardConfig): Promise<Draft | null> {
  try {
    const raw = JSON.parse(await readFile(pendingPath(cfg), "utf8")) as Partial<PendingFile>;
    return {
      board: parseBoard(raw.board),
      removedTaskIds: new Set(Array.isArray(raw.removedTaskIds) ? raw.removedTaskIds : []),
      removedMemberIds: new Set(Array.isArray(raw.removedMemberIds) ? raw.removedMemberIds : []),
      dirty: true,
    };
  } catch {
    return null;
  }
}

async function writePending(cfg: BoardConfig, draft: Draft): Promise<void> {
  const path = pendingPath(cfg);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload: PendingFile = {
    board: draft.board,
    removedTaskIds: [...draft.removedTaskIds],
    removedMemberIds: [...draft.removedMemberIds],
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

async function removePending(cfg: BoardConfig): Promise<void> {
  await unlink(pendingPath(cfg)).catch(() => undefined);
}

async function doHydrate(): Promise<void> {
  const configs = await readConfigs();
  for (const cfg of configs) {
    const draft = await readPending(cfg);
    if (draft) drafts.set(cfg.id, draft);
  }
  if ([...drafts.values()].some((d) => d.dirty)) scheduleFlush();
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = doHydrate();
  return hydration;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushAll();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

async function writeAndPush(cfg: BoardConfig, merged: TeamBoard): Promise<void> {
  await writeFile(join(cfg.dir, BOARD_FILE), `${JSON.stringify(merged, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await git(cfg.dir, ["add", BOARD_FILE]);
  try {
    await git(cfg.dir, ["commit", "-q", "-m", `hq: ${new Date().toISOString()}`]);
  } catch (err) {
    const text = errorText(err);
    if (!/nothing to commit|no changes added|empty commit/i.test(text)) {
      throw new Error(`не удалось сохранить доску: ${text}`);
    }
  }
  if (!(await hasHead(cfg.dir))) return;
  try {
    await git(cfg.dir, ["push", "origin", cfg.branch], 120000);
  } catch {
    try {
      await git(cfg.dir, ["pull", "--rebase", "--autostash", "origin", cfg.branch], 120000);
      await git(cfg.dir, ["push", "origin", cfg.branch], 120000);
    } catch (err) {
      await git(cfg.dir, ["rebase", "--abort"]).catch(() => undefined);
      throw new Error(`не удалось отправить доску: ${errorText(err)}`);
    }
  }
}

/** Синхронное сохранение прямо в git: подтянуть, слить, записать, запушить. */
export async function saveBoard(
  cfg: BoardConfig,
  incoming: TeamBoard,
  removedTaskIds: readonly string[] = [],
  removedMemberIds: readonly string[] = [],
): Promise<TeamBoard> {
  await pullRepo(cfg);
  const remote = await readBoard(cfg);
  const merged = mergeBoard(remote, incoming, removedTaskIds, removedMemberIds);
  await writeAndPush(cfg, merged);
  return merged;
}

async function flushBoard(boardId: string, draft: Draft): Promise<void> {
  const cfg = await getConfig(boardId);
  if (!cfg || !draft.dirty) return;
  try {
    await pullRepo(cfg);
    const remote = await readBoard(cfg);
    const merged = mergeBoard(remote, draft.board, [...draft.removedTaskIds], [...draft.removedMemberIds]);
    await writeAndPush(cfg, merged);
    draft.board = merged;
    draft.dirty = false;
    draft.removedTaskIds.clear();
    draft.removedMemberIds.clear();
    await removePending(cfg);
  } catch (err) {
    console.warn("[team] flush failed:", (err as Error)?.message || err);
  }
}

export async function flushAll(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    await ensureHydrated();
    for (const [boardId, draft] of drafts) {
      if (draft.dirty) await flushBoard(boardId, draft);
    }
  } finally {
    flushing = false;
  }
}

export async function boardView(boardId: string): Promise<TeamBoard> {
  await ensureHydrated();
  const draft = drafts.get(boardId);
  if (draft) return draft.board;
  const cfg = await getConfig(boardId);
  if (!cfg) return { ...EMPTY_BOARD };
  return readBoard(cfg);
}

/**
 * Правка из интерфейса: сразу применяем в память и в локальный pending-файл,
 * а в git отправляем пачкой раз в минуту (flushAll).
 */
export async function applyBoardChange(
  boardId: string,
  incoming: TeamBoard,
  removedTaskIds: readonly string[] = [],
  removedMemberIds: readonly string[] = [],
): Promise<TeamBoard> {
  await ensureHydrated();
  const cfg = await getConfig(boardId);
  if (!cfg) throw new Error("доска не найдена");
  const draft: Draft =
    drafts.get(boardId) ?? {
      board: await readBoard(cfg),
      removedTaskIds: new Set<string>(),
      removedMemberIds: new Set<string>(),
      dirty: false,
    };
  const merged = mergeBoard(draft.board, incoming, removedTaskIds, removedMemberIds);
  draft.board = merged;
  for (const id of removedTaskIds) draft.removedTaskIds.add(id);
  for (const id of removedMemberIds) draft.removedMemberIds.add(id);
  for (const task of incoming.tasks) draft.removedTaskIds.delete(task.id);
  for (const member of incoming.members) draft.removedMemberIds.delete(member.id);
  draft.dirty = true;
  drafts.set(boardId, draft);
  await writePending(cfg, draft);
  scheduleFlush();
  return merged;
}

export async function connectBoard(
  url: string,
  branch: string,
): Promise<{ id: string; url: string; branch: string; dir: string; name: string }> {
  const normalized = normalizeUrl(url);
  const branchName = branch.trim() || "main";
  const id = newId("b");
  const cfg: BoardConfig = { id, url: normalized, branch: branchName, dir: join(BASE_DIR, `board-${id}`) };
  await ensureRepo(cfg);
  await pullRepo(cfg);
  const board = await readBoard(cfg);
  const configs = await readConfigs();
  configs.push(cfg);
  await writeConfigs(configs);
  return { id, url: normalized, branch: branchName, dir: cfg.dir, name: boardDisplayName(normalized, board.name) };
}

export async function disconnectBoard(boardId: string): Promise<void> {
  drafts.delete(boardId);
  const configs = await readConfigs();
  const cfg = configs.find((b) => b.id === boardId);
  await writeConfigs(configs.filter((b) => b.id !== boardId));
  if (cfg) {
    await removePending(cfg);
    await rename(cfg.dir, `${cfg.dir}.previous-${Date.now()}`).catch(() => undefined);
  }
}

export async function listBoards(): Promise<
  { id: string; url: string; branch: string; dir: string; name: string; syncedAt: string | null }[]
> {
  await ensureHydrated();
  const configs = await readConfigs();
  const result = [];
  for (const cfg of configs) {
    const draft = drafts.get(cfg.id);
    const board = draft ? draft.board : await readBoard(cfg);
    result.push({
      id: cfg.id,
      url: cfg.url,
      branch: cfg.branch,
      dir: cfg.dir,
      name: boardDisplayName(cfg.url, board.name),
      syncedAt: board.updatedAt || null,
    });
  }
  return result;
}

export async function syncBoard(boardId: string): Promise<TeamBoard> {
  await ensureHydrated();
  const cfg = await getConfig(boardId);
  if (!cfg) throw new Error("доска не найдена");
  await pullRepo(cfg);
  const remote = await readBoard(cfg);
  const draft = drafts.get(boardId);
  if (draft && draft.dirty) {
    const merged = mergeBoard(remote, draft.board, [...draft.removedTaskIds], [...draft.removedMemberIds]);
    draft.board = merged;
    await writePending(cfg, draft);
    return merged;
  }
  return remote;
}
