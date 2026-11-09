import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { RepoItem, AuthStatus } from "../shared/git-contracts";
import {
  fetchGitHubRepos,
  fetchGitLabRepos,
  checkGitHubAuth,
  checkGitLabAuth,
  parseGitLabHost,
  resolveCloneDir,
  existingCheckouts,
  resolveExistingCheckout,
} from "./git-service.server";

interface CacheData {
  lastSyncedAt: number;
  github: RepoItem[];
  gitlab: Record<string, RepoItem[]>; // host -> repos
  auth: {
    github?: AuthStatus;
    gitlab?: Record<string, AuthStatus>;
  };
}

const CACHE_FILE = path.join(os.homedir(), ".paseo", "git-workspace-cache.json");

class RepoCacheService {
  private cache: CacheData = {
    lastSyncedAt: 0,
    github: [],
    gitlab: {},
    auth: {},
  };
  private isSyncing = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  async init(gitlabUrl?: string, cloneDir?: string) {
    if (this.initialized) return;
    this.initialized = true;

    // Load from disk
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(data) as CacheData;
      if (parsed && typeof parsed.lastSyncedAt === "number") {
        this.cache = parsed;
      }
    } catch {
      // Ignore missing cache file
    }

    // Initial background sync
    setTimeout(() => {
      void this.syncAll(gitlabUrl, cloneDir);
    }, 500);

    // Periodic sync every 3 minutes
    this.syncTimer = setInterval(() => {
      void this.syncAll(gitlabUrl, cloneDir);
    }, 3 * 60 * 1000);
  }

  destroy() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async getAuth(gitlabUrl?: string, forceRefresh = false): Promise<{ github: AuthStatus; gitlab: AuthStatus }> {
    const host = parseGitLabHost(gitlabUrl);
    const cachedGh = this.cache.auth?.github;
    const cachedGl = this.cache.auth?.gitlab?.[host];

    if (!forceRefresh && cachedGh && cachedGl) {
      return { github: cachedGh, gitlab: cachedGl };
    }

    const [gh, gl] = await Promise.all([
      checkGitHubAuth(),
      checkGitLabAuth(gitlabUrl),
    ]);

    if (!this.cache.auth) this.cache.auth = {};
    if (!this.cache.auth.gitlab) this.cache.auth.gitlab = {};
    this.cache.auth.github = gh;
    this.cache.auth.gitlab[host] = gl;

    void this.persist();
    return { github: gh, gitlab: gl };
  }

  async syncAll(gitlabUrl?: string, cloneDir?: string): Promise<{ lastSyncedAt: number; auth: { github: AuthStatus; gitlab: AuthStatus } }> {
    if (this.isSyncing) {
      const auth = await this.getAuth(gitlabUrl, false);
      return { lastSyncedAt: this.cache.lastSyncedAt, auth };
    }
    this.isSyncing = true;
    const baseDir = resolveCloneDir(cloneDir);
    const host = parseGitLabHost(gitlabUrl);

    try {
      const [ghAuth, glAuth, ghRepos, glRepos] = await Promise.allSettled([
        checkGitHubAuth(),
        checkGitLabAuth(gitlabUrl),
        fetchGitHubRepos(undefined, baseDir),
        fetchGitLabRepos(undefined, gitlabUrl, baseDir),
      ]);

      if (!this.cache.auth) this.cache.auth = {};
      if (!this.cache.auth.gitlab) this.cache.auth.gitlab = {};

      if (ghAuth.status === "fulfilled") {
        this.cache.auth.github = ghAuth.value;
      }
      if (glAuth.status === "fulfilled") {
        this.cache.auth.gitlab[host] = glAuth.value;
      }

      if (ghRepos.status === "fulfilled" && ghRepos.value.length > 0) {
        this.cache.github = this.mergeRepos(this.cache.github, ghRepos.value);
      }

      if (glRepos.status === "fulfilled" && glRepos.value.length > 0) {
        this.cache.gitlab[host] = this.mergeRepos(this.cache.gitlab[host] || [], glRepos.value);
      }

      this.cache.lastSyncedAt = Date.now();
      await this.persist();
    } catch (err: unknown) {
      console.error("[git-workspace] Sync error:", err);
    } finally {
      this.isSyncing = false;
    }

    const auth = {
      github: this.cache.auth?.github || { installed: false, loggedIn: false },
      gitlab: this.cache.auth?.gitlab?.[host] || { installed: false, loggedIn: false },
    };

    return { lastSyncedAt: this.cache.lastSyncedAt, auth };
  }

  private async persist() {
    try {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch (err: unknown) {
      console.error("[git-workspace] Persist error:", err);
    }
  }

  private mergeRepos(existing: RepoItem[], incoming: RepoItem[]): RepoItem[] {
    const map = new Map<string, RepoItem>();
    for (const item of existing) {
      map.set(item.id, item);
    }
    for (const item of incoming) {
      map.set(item.id, item);
    }
    return Array.from(map.values());
  }

  async getRepos(params: {
    provider?: "all" | "github" | "gitlab";
    query?: string;
    gitlabUrl?: string;
    cloneDir?: string;
    forceRefresh?: boolean;
  }): Promise<{
    repos: RepoItem[];
    lastSyncedAt: number;
    isSyncing: boolean;
    auth: { github: AuthStatus; gitlab: AuthStatus };
  }> {
    const baseDir = resolveCloneDir(params.cloneDir);
    const host = parseGitLabHost(params.gitlabUrl);

    if (params.forceRefresh || this.cache.lastSyncedAt === 0) {
      void this.syncAll(params.gitlabUrl, params.cloneDir);
    }

    let all: RepoItem[] = [];

    if (params.provider === "all" || params.provider === "github") {
      all.push(...this.cache.github);
    }

    if (params.provider === "all" || params.provider === "gitlab") {
      const glList = this.cache.gitlab[host] || [];
      all.push(...glList);
    }

    const localIndex = await existingCheckouts(baseDir);
    const updated = await Promise.all(
      all.map(async (item) => {
        const itemHost = item.provider === "github" ? "github.com" : host;
        const target = path.join(baseDir, itemHost, item.fullName);
        try {
          const existing = await resolveExistingCheckout(baseDir, itemHost, item.fullName, localIndex);
          return { ...item, isLocal: Boolean(existing), localPath: existing ?? target };
        } catch {
          // Let the create action explain collisions without modifying either copy.
          return { ...item, isLocal: true, localPath: target };
        }
      }),
    );

    let filtered = updated;
    if (params.query && params.query.trim()) {
      const q = params.query.trim().toLowerCase();
      filtered = updated.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }

    const auth = {
      github: this.cache.auth?.github || { installed: true, loggedIn: false },
      gitlab: this.cache.auth?.gitlab?.[host] || { installed: true, loggedIn: false },
    };

    return {
      repos: filtered,
      lastSyncedAt: this.cache.lastSyncedAt,
      isSyncing: this.isSyncing,
      auth,
    };
  }
}

export const repoCacheService = new RepoCacheService();
