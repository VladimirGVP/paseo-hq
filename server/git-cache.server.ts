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
  errors?: string[];
  lastSyncedAt: number;
  github: RepoItem[];
  gitlab: Record<string, RepoItem[]>; // host -> repos
  auth: {
    github?: AuthStatus;
    gitlab?: Record<string, AuthStatus>;
  };
}

const CACHE_FILE = path.join(os.homedir(), ".paseo", "git-workspace-cache.json");

export class RepoCacheService {
  private cache: CacheData = {
    lastSyncedAt: 0,
    github: [],
    gitlab: {},
    auth: {},
  };
  private epoch = 0;
  private syncTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  constructor(private readonly cacheFile: string = CACHE_FILE) {}
  private syncPromise: ReturnType<RepoCacheService["performSync"]> | null = null;

  clear() {
    this.epoch++;
    this.syncPromise = null;
    this.cache = { lastSyncedAt: 0, github: [], gitlab: {}, auth: {} };
  }

  async init(gitlabUrl?: string, cloneDir?: string) {
    if (this.initialized) return;
    this.initialized = true;

    // Load from disk
    try {
      const data = await fs.readFile(this.cacheFile, "utf-8");
      const parsed = JSON.parse(data) as CacheData;
      if (parsed && typeof parsed.lastSyncedAt === "number") {
        this.cache = parsed;
      }
    } catch {
      // Ignore missing cache file
    }

    // Initial background sync
    setTimeout(() => {
      void this.syncAll(gitlabUrl, cloneDir).catch((error) => console.error("[git-workspace] Background sync failed", error));
    }, 500);

    // Periodic sync every 3 minutes
    this.syncTimer = setInterval(() => {
      void this.syncAll(gitlabUrl, cloneDir).catch((error) => console.error("[git-workspace] Background sync failed", error));
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
    if (this.cache.auth.github?.user !== gh.user || !gh.loggedIn) this.cache.github = [];
    if (this.cache.auth.gitlab[host]?.user !== gl.user || !gl.loggedIn) this.cache.gitlab[host] = [];
    this.cache.auth.github = gh;
    this.cache.auth.gitlab[host] = gl;

    void this.persist();
    return { github: gh, gitlab: gl };
  }

  async syncAll(gitlabUrl?: string, cloneDir?: string): Promise<{ lastSyncedAt: number; auth: { github: AuthStatus; gitlab: AuthStatus } }> {
    if (this.syncPromise) {
      return this.syncPromise;
    }
    const pending = this.performSync(gitlabUrl, cloneDir);
    this.syncPromise = pending;
    try { return await pending; } finally { if (this.syncPromise === pending) this.syncPromise = null; }
  }

  private async performSync(gitlabUrl?: string, cloneDir?: string): Promise<{ lastSyncedAt: number; auth: { github: AuthStatus; gitlab: AuthStatus } }> {
    const epoch = this.epoch;
    const baseDir = resolveCloneDir(cloneDir);
    const host = parseGitLabHost(gitlabUrl);

    try {
      const [ghAuth, glAuth, ghRepos, glRepos] = await Promise.allSettled([
        checkGitHubAuth(),
        checkGitLabAuth(gitlabUrl),
        fetchGitHubRepos(undefined, baseDir),
        fetchGitLabRepos(undefined, gitlabUrl, baseDir),
      ]);

      if (epoch !== this.epoch) return { lastSyncedAt: this.cache.lastSyncedAt, auth: { github: { installed: true, loggedIn: false }, gitlab: { installed: true, loggedIn: false } } };
      if (!this.cache.auth) this.cache.auth = {};
      if (!this.cache.auth.gitlab) this.cache.auth.gitlab = {};

      if (ghAuth.status === "fulfilled") {
        if (this.cache.auth.github?.user !== ghAuth.value.user || !ghAuth.value.loggedIn) this.cache.github = [];
        this.cache.auth.github = ghAuth.value;
      }
      if (glAuth.status === "fulfilled") {
        if (this.cache.auth.gitlab[host]?.user !== glAuth.value.user || !glAuth.value.loggedIn) this.cache.gitlab[host] = [];
        this.cache.auth.gitlab[host] = glAuth.value;
      }

      this.cache.errors = [];
      if (ghAuth.status === "fulfilled" && ghAuth.value.error) this.cache.errors.push("GitHub: " + ghAuth.value.error);
      if (glAuth.status === "fulfilled" && glAuth.value.error) this.cache.errors.push("GitLab: " + glAuth.value.error);
      if (ghRepos.status === "fulfilled" && ghAuth.status === "fulfilled" && ghAuth.value.loggedIn) {
        this.cache.github = ghRepos.value;
      } else if (ghRepos.status === "rejected") {
        this.cache.errors.push("GitHub: " + String(ghRepos.reason instanceof Error ? ghRepos.reason.message : ghRepos.reason));
      }
      if (glRepos.status === "fulfilled" && glAuth.status === "fulfilled" && glAuth.value.loggedIn) {
        this.cache.gitlab[host] = glRepos.value;
      } else if (glRepos.status === "rejected") {
        this.cache.errors.push("GitLab: " + String(glRepos.reason instanceof Error ? glRepos.reason.message : glRepos.reason));
      }

      this.cache.lastSyncedAt = Date.now();
      await this.persist();
    } catch (err: unknown) {
      this.cache.errors = [err instanceof Error ? err.message : String(err)];
      throw err;
    }

    const auth = {
      github: this.cache.auth?.github || { installed: false, loggedIn: false },
      gitlab: this.cache.auth?.gitlab?.[host] || { installed: false, loggedIn: false },
    };

    return { lastSyncedAt: this.cache.lastSyncedAt, auth };
  }

  private async persist() {
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2), { encoding: "utf-8", mode: 0o600 });
    } catch (err: unknown) {
      console.error("[git-workspace] Persist error:", err);
    }
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
    errors: string[];
    auth: { github: AuthStatus; gitlab: AuthStatus };
  }> {
    const baseDir = resolveCloneDir(params.cloneDir);
    const host = parseGitLabHost(params.gitlabUrl);

    if (params.forceRefresh || this.cache.lastSyncedAt === 0) {
      await this.syncAll(params.gitlabUrl, params.cloneDir);
    } else if (this.syncPromise) {
      await this.syncPromise;
    }

    let all: RepoItem[] = [];

    if (!params.provider || params.provider === "all" || params.provider === "github") {
      all.push(...this.cache.github);
    }

    if (!params.provider || params.provider === "all" || params.provider === "gitlab") {
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
      isSyncing: this.syncPromise !== null,
      errors: this.cache.errors ?? [],
      auth,
    };
  }
}

export const repoCacheService = new RepoCacheService();
