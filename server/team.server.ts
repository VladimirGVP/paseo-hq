import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  EMPTY_BOARD,
  mergeBoard,
  parseBoard,
  teamRepoSchema,
  type TeamBoard,
  type TeamRepo,
} from "../shared/team-model.ts";

const execFileAsync = promisify(execFile);

export const BOARD_FILE = "hq.json";
const CONFIG_FILE =
  process.env.PASEO_HQ_TEAM_CONFIG || join(homedir(), ".local", "state", "paseo-hq", "team.json");
const DEFAULT_DIR =
  process.env.PASEO_HQ_TEAM_DIR || join(homedir(), ".local", "state", "paseo-hq", "team-repo");

let cachedRepo: TeamRepo | null | undefined;

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  return trimmed;
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

export async function readRepoConfig(): Promise<TeamRepo | null> {
  if (cachedRepo !== undefined) return cachedRepo;
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as { repo?: unknown };
    const parsed = teamRepoSchema.safeParse(raw?.repo);
    cachedRepo = parsed.success ? parsed.data : null;
  } catch {
    cachedRepo = null;
  }
  return cachedRepo;
}

export async function writeRepoConfig(repo: TeamRepo | null): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ repo }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, CONFIG_FILE);
  cachedRepo = repo;
}

export async function ensureRepo(repo: TeamRepo): Promise<void> {
  if (!(await isRepo(repo.dir))) {
    await mkdir(dirname(repo.dir), { recursive: true, mode: 0o700 });
    try {
      await execFileAsync("git", ["clone", "--", repo.url, repo.dir], {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch (err) {
      throw new Error(`не удалось склонировать репозиторий: ${errorText(err)}`);
    }
  } else {
    const origin = await remoteUrl(repo.dir);
    if (origin && origin !== repo.url) {
      throw new Error("к папке уже подключён другой репозиторий, сначала отключите текущий");
    }
  }

  await configureGit(repo.dir);

  if (!(await hasHead(repo.dir))) {
    // Клон пустого репозитория или репозитория, где нужная ветка не была веткой по умолчанию.
    const remoteBranch = await git(repo.dir, [
      "rev-parse",
      "--verify",
      `refs/remotes/origin/${repo.branch}`,
    ])
      .then(() => true)
      .catch(() => false);
    if (remoteBranch) {
      await git(repo.dir, ["checkout", "-q", "-B", repo.branch, `origin/${repo.branch}`]);
    } else {
      await git(repo.dir, ["symbolic-ref", "HEAD", `refs/heads/${repo.branch}`]);
    }
    return;
  }

  const branchExists = await git(repo.dir, ["rev-parse", "--verify", `refs/heads/${repo.branch}`])
    .then(() => true)
    .catch(() => false);
  if (!branchExists) {
    await git(repo.dir, ["checkout", "-q", "-b", repo.branch]);
  } else {
    const current = (await git(repo.dir, ["branch", "--show-current"])).trim();
    if (current !== repo.branch) await git(repo.dir, ["checkout", "-q", repo.branch]);
  }
}

export async function pullRepo(repo: TeamRepo): Promise<void> {
  await ensureRepo(repo);
  if (!(await hasHead(repo.dir))) return;
  try {
    await git(repo.dir, ["pull", "--rebase", "--autostash", "origin", repo.branch], 120000);
  } catch (err) {
    await git(repo.dir, ["rebase", "--abort"]).catch(() => undefined);
    const text = errorText(err);
    if (/couldn't find remote ref|no such ref|not found/i.test(text)) return;
    throw new Error(`не удалось обновить репозиторий: ${text}`);
  }
}

export async function readBoard(repo: TeamRepo): Promise<TeamBoard> {
  try {
    const raw = await readFile(join(repo.dir, BOARD_FILE), "utf8");
    return parseBoard(JSON.parse(raw));
  } catch {
    return { ...EMPTY_BOARD };
  }
}

export async function saveBoard(
  repo: TeamRepo,
  incoming: TeamBoard,
  removedTaskIds: readonly string[] = [],
  removedMemberIds: readonly string[] = [],
): Promise<TeamBoard> {
  await pullRepo(repo);
  const remote = await readBoard(repo);
  const merged = mergeBoard(remote, incoming, removedTaskIds, removedMemberIds);

  await writeFile(join(repo.dir, BOARD_FILE), `${JSON.stringify(merged, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await git(repo.dir, ["add", BOARD_FILE]);
  try {
    await git(repo.dir, ["commit", "-q", "-m", `hq: ${new Date().toISOString()}`]);
  } catch (err) {
    const text = errorText(err);
    if (!/nothing to commit|no changes added|empty commit/i.test(text)) {
      throw new Error(`не удалось сохранить доску: ${text}`);
    }
  }
  if (await hasHead(repo.dir)) {
    try {
      await git(repo.dir, ["push", "origin", repo.branch], 120000);
    } catch {
      try {
        await git(repo.dir, ["pull", "--rebase", "--autostash", "origin", repo.branch], 120000);
        await git(repo.dir, ["push", "origin", repo.branch], 120000);
      } catch (err) {
        await git(repo.dir, ["rebase", "--abort"]).catch(() => undefined);
        throw new Error(`не удалось отправить доску: ${errorText(err)}`);
      }
    }
  }
  return merged;
}

export async function connectRepo(
  url: string,
  branch: string,
): Promise<{ repo: TeamRepo; board: TeamBoard }> {
  const repo: TeamRepo = {
    url: normalizeUrl(url),
    branch: branch.trim() || "main",
    dir: DEFAULT_DIR,
  };
  await ensureRepo(repo);
  await pullRepo(repo);
  const board = await readBoard(repo);
  await writeRepoConfig(repo);
  return { repo, board };
}

export async function disconnectRepo(): Promise<void> {
  const repo = await readRepoConfig();
  await writeRepoConfig(null);
  if (repo) {
    // Не удаляем клон: в нём может остаться неотправленная доска. Просто убираем с пути.
    await rename(repo.dir, `${repo.dir}.previous-${Date.now()}`).catch(() => undefined);
  }
}

export async function syncBoard(): Promise<TeamBoard> {
  const repo = await readRepoConfig();
  if (!repo) throw new Error("репозиторий команды не подключён");
  await pullRepo(repo);
  return readBoard(repo);
}
