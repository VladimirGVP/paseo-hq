import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RepoItem } from "../shared/git-contracts";

const exec = promisify(execFile);

export function gitCliExecutable(provider: "github" | "gitlab"): string {
  if (provider === "github") return "gh";
  const local = path.join(os.homedir(), ".local/bin/glab");
  return existsSync(local) ? local : "glab";
}

async function repositoryPages(provider: "github" | "gitlab", endpoint: string, host?: string): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const args = ["api", `${endpoint}&per_page=100&page=${page}`];
    if (host) args.push("--hostname", host);
    const { stdout } = await exec(gitCliExecutable(provider), args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const items: unknown = JSON.parse(stdout);
    if (!Array.isArray(items)) throw new Error(`${provider}: unexpected repository list response`);
    all.push(...items);
    if (items.length < 100) return all;
  }
}

export function parseGitLabHost(urlOrHost?: string): string {
  if (!urlOrHost || !urlOrHost.trim()) return "gitlab.com";
  const raw = urlOrHost.trim();
  const match = raw.match(/^(?:https?:\/\/)?([^/:]+)(?::\d+)?/);
  if (match && match[1]) {
    return match[1];
  }
  return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function resolveCloneDir(dir?: string): string {
  const d = dir?.trim() || "~/repos";
  if (d.startsWith("~")) {
    return path.join(os.homedir(), d.slice(1));
  }
  return path.resolve(d);
}

export async function checkGitHubAuth(): Promise<{
  installed: boolean;
  loggedIn: boolean;
  user?: string;
  error?: string;
}> {
  try {
    const { stdout } = await exec("gh", ["api", "user", "--jq", ".login"], { timeout: 20_000 });
    const username = stdout.trim();
    return {
      installed: true,
      loggedIn: true,
      user: username,
    };
  } catch (err: unknown) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(err.stderr)
        : err instanceof Error
          ? err.message
          : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "";
    if (code === "ENOENT") {
      return {
        installed: false,
        loggedIn: false,
        error: "GitHub CLI (gh) не установлен",
      };
    }
    return {
      installed: true,
      loggedIn: false,
      error: stderr.trim() || "Вход в GitHub CLI не выполнен",
    };
  }
}

export async function checkGitLabAuth(gitlabUrl?: string): Promise<{
  installed: boolean;
  loggedIn: boolean;
  host: string;
  user?: string;
  error?: string;
}> {
  const host = parseGitLabHost(gitlabUrl);
  try {
    const { stdout } = await exec(gitCliExecutable("gitlab"), ["api", "user", "--hostname", host], { timeout: 20_000 });
    const username = z.object({ username: z.string().min(1) }).parse(JSON.parse(stdout)).username;
    return {
      installed: true,
      loggedIn: true,
      host,
      user: username,
    };
  } catch (err: unknown) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(err.stderr)
        : err instanceof Error
          ? err.message
          : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "";
    if (code === "ENOENT") {
      return {
        installed: false,
        loggedIn: false,
        host,
        error: "GitLab CLI (glab) не установлен",
      };
    }
    return {
      installed: true,
      loggedIn: false,
      host,
      error: stderr.trim() || `GitLab CLI (${host}) вход не выполнен`,
    };
  }
}

async function isGitRepoLocally(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(targetPath, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

// Existing primary checkouts in the root can have names unlike their remote.
export function remoteKey(remote: string): string | undefined {
  const value = remote.trim();
  const match = value.match(/^(?:https?:\/\/|ssh:\/\/(?:git@)?|git@)([^/:]+)[:/]([^?#]+?)(?:\.git)?\/?$/);
  return match ? `${match[1].toLowerCase()}/${match[2].replace(/\.git\/?$/, "").replace(/\/$/, "")}` : undefined;
}

export async function existingCheckouts(base: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(base, { withFileTypes: true }); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return index;
    throw error;
  }
  await Promise.all(entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map(async (entry) => {
    const dir = path.join(base, entry.name);
    if (!await isGitRepoLocally(dir)) return;
    try {
      const { stdout } = await exec("git", ["-C", dir, "config", "--get", "remote.origin.url"]);
      const key = remoteKey(stdout);
      if (key) index.set(key, [...(index.get(key) ?? []), dir]);
    } catch { /* A local repository without an origin cannot be matched. */ }
  }));
  return index;
}

export async function resolveExistingCheckout(base: string, host: string, name: string, index: Map<string, string[]>): Promise<string | undefined> {
  const target = path.join(base, host, name);
  const key = `${host.toLowerCase()}/${name}`;
  const matches = [...(index.get(key) ?? [])];
  if (await isGitRepoLocally(target)) {
    const { stdout } = await exec("git", ["-C", target, "config", "--get", "remote.origin.url"]);
    if (remoteKey(stdout) !== key) throw new Error("В целевой папке находится другой репозиторий: " + target);
    if (!matches.includes(target)) matches.push(target);
  }
  if (matches.length > 1) throw new Error("Найдено несколько копий репозитория: " + matches.join(", "));
  return matches[0];
}

const githubRepoSchema = z.object({
  full_name: z.string().min(1), html_url: z.string().url(), name: z.string().optional(),
  description: z.string().nullable().optional(), ssh_url: z.string().optional(), clone_url: z.string().optional(),
  private: z.boolean().default(false), default_branch: z.string().optional(),
});

export async function fetchGitHubRepos(query: string | undefined, cloneBaseDir: string): Promise<RepoItem[]> {
  // /user/repos includes repositories shared by organizations and collaborators.
  // `gh repo list` lists only repositories owned by the current user.
  const items = await repositoryPages("github", "user/repos?affiliation=owner,collaborator,organization_member&sort=updated");
  const localIndex = await existingCheckouts(cloneBaseDir);
  const results: RepoItem[] = [];
  for (const raw of items) {
    const item = githubRepoSchema.parse(raw);
    const fullName = item.full_name;
    if (query && !`${fullName} ${item.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) continue;
    const matches = localIndex.get(`github.com/${fullName}`) ?? [];
    const target = path.join(cloneBaseDir, "github.com", fullName);
    results.push({
      id: `github:${fullName}`, name: item.name || fullName.split("/").at(-1)!, fullName,
      description: item.description || "", url: item.html_url,
      sshUrl: item.ssh_url || `git@github.com:${fullName}.git`,
      httpUrl: item.clone_url || `${item.html_url}.git`,
      defaultBranch: item.default_branch || "main", provider: "github", isPrivate: Boolean(item.private),
      isLocal: matches.length > 0 || await isGitRepoLocally(target),
      localPath: matches.length === 1 ? matches[0]! : target,
    });
  }
  return results;
}

const gitlabRepoSchema = z.object({
  path_with_namespace: z.string().min(1), web_url: z.string().url(), name: z.string().optional(),
  description: z.string().nullable().optional(), ssh_url_to_repo: z.string().optional(), http_url_to_repo: z.string().optional(),
  default_branch: z.string().optional(), visibility: z.string(),
});

export async function fetchGitLabRepos(query: string | undefined, gitlabUrl: string | undefined, cloneBaseDir: string): Promise<RepoItem[]> {
  const host = parseGitLabHost(gitlabUrl);
  const endpoint = "projects?membership=true&order_by=last_activity_at" + (query?.trim() ? `&search=${encodeURIComponent(query.trim())}` : "");
  const items = await repositoryPages("gitlab", endpoint, host);
  const localIndex = await existingCheckouts(cloneBaseDir);
  const results: RepoItem[] = [];
  for (const raw of items) {
    const item = gitlabRepoSchema.parse(raw);
    const fullName = item.path_with_namespace;
    const matches = localIndex.get(`${host.toLowerCase()}/${fullName}`) ?? [];
    const target = path.join(cloneBaseDir, host, fullName);
    results.push({
      id: `gitlab:${host}:${fullName}`, name: item.name || fullName.split("/").at(-1)!, fullName,
      description: item.description || "", url: item.web_url,
      sshUrl: item.ssh_url_to_repo || `git@${host}:${fullName}.git`,
      httpUrl: item.http_url_to_repo || `https://${host}/${fullName}.git`,
      defaultBranch: item.default_branch || "main", provider: "gitlab",
      isPrivate: item.visibility === "private" || item.visibility === "internal",
      isLocal: matches.length > 0 || await isGitRepoLocally(target),
      localPath: matches.length === 1 ? matches[0]! : target,
    });
  }
  return results;
}

export async function cloneAndCreateWorkspace(
  params: {
    provider: "github" | "gitlab";
    repoFullName: string;
    cloneUrl: string;
    branch?: string;
    isolation: "worktree" | "local";
    gitlabUrl?: string;
    cloneDir?: string;
  },
  paseo: PluginHandlerContext["paseo"],
): Promise<{ workspaceId: string; title: string; localPath: string }> {
  const cloneBaseDir = resolveCloneDir(params.cloneDir);
  const host = params.provider === "github" ? "github.com" : parseGitLabHost(params.gitlabUrl);
  const localIndex = await existingCheckouts(cloneBaseDir);
  const existingPath = await resolveExistingCheckout(cloneBaseDir, host, params.repoFullName, localIndex);
  const targetPath = existingPath ?? path.join(cloneBaseDir, host, params.repoFullName);

  const isLocal = Boolean(existingPath);

  // 1. 如果本地尚未克隆，先执行完整 clone 以确保 .git 和 HEAD 结构完整
  if (!isLocal) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    console.log(`[git-workspace] Cloning ${params.cloneUrl} into ${targetPath}...`);
    const cloneArgs = ["clone", params.cloneUrl, targetPath];
    if (params.cloneUrl.startsWith("https://")) {
      const binary = gitCliExecutable(params.provider);
      const quoted = "'" + binary.replace(/'/g, "'\"'\"'") + "'";
      cloneArgs.unshift("-c", "credential.helper=", "-c", `credential.helper=!${quoted} auth git-credential`);
    }
    await exec("git", cloneArgs, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 120_000 });
    console.log(`[git-workspace] Clone completed for ${params.repoFullName}`);
  }

  // 2. 本地已完整存在，安全创建 Paseo 工作区
  const workspace = await paseo.workspaces.create({
    title: params.repoFullName,
    source:
      params.isolation === "worktree"
        ? {
            kind: "worktree",
            cwd: targetPath,
            action: "checkout",
            refName: params.branch || undefined,
          }
        : {
            kind: "directory",
            path: targetPath,
          },
  });

  return {
    workspaceId: workspace.id,
    title: params.repoFullName,
    localPath: targetPath,
  };
}
