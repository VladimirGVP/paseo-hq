// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  EnvironmentDetail,
  EnvironmentDetailResult,
  EnvironmentInfo,
  EnvironmentThread,
} from "../../shared/genui/core/environments";
import {
  matchesPathFilter,
  MAX_COMMITS,
  parseChangesTarget,
  parsePathFilter,
  type ChangedFile,
  type ChangeKind,
  type ChangesResult,
  type ChangesScope,
  type ChangesTarget,
  type CommitsResult,
  type EnvironmentsResult,
  type FilePatch,
  type MissingThread,
  type PatchesResult,
  type ProjectFailure,
  type ProjectRequest,
  type ProjectResult,
  type PullRequestInfo,
  type PullRequestResult,
  type ThreadDisplayStatus,
  type ThreadInfo,
  type ThreadsResult,
} from "../../shared/genui/core/project";
import { lastMessage } from "../../shared/genui/core/thread-activity";
import { resolveAgentCwd } from "./data-source";

type PaseoApi = PluginHandlerContext["paseo"];

const execFileAsync = promisify(execFile);

function failure(reason: ProjectFailure["reason"], message: string): ProjectFailure {
  return { ok: false, reason, message };
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10_000,
    });
    return { ok: true, stdout };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export async function detectGitBranches(cwd: string): Promise<
  | {
      ok: true;
      branch: string | null;
      head: string | null;
      base: string;
      /** The ref to diff against: origin/<base> when it exists, so a stale local branch doesn't skew it. */
      baseRef: string;
      checkout: "branch" | "detached" | "unborn";
    }
  | ProjectFailure
> {
  const inside = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return failure("not-git", "This agent's workspace isn't a git checkout");
  }
  const sym = await runGit(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const headRes = await runGit(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
  const head = headRes.ok ? headRes.stdout.trim().slice(0, 7) : null;
  const branch = sym.ok ? sym.stdout.trim() || null : null;
  const checkout = head === null ? "unborn" : branch !== null ? "branch" : "detached";

  const originHead = await runGit(cwd, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
  const defaultBranch = originHead.ok ? originHead.stdout.trim().replace(/^origin\//, "") : "";
  const { base, baseRef } = await closestBase(cwd, branch, head !== null, defaultBranch);
  return { ok: true, branch, head, base, baseRef, checkout };
}

const BASE_CANDIDATES = ["main", "master", "dev", "develop"];

/** Feature branches often fork from dev rather than the default branch, so pick the candidate fewest commits behind HEAD. */
async function closestBase(
  cwd: string,
  branch: string | null,
  hasHead: boolean,
  defaultBranch: string,
): Promise<{ base: string; baseRef: string }> {
  const names = [...new Set([defaultBranch, ...BASE_CANDIDATES].filter(Boolean))];
  // Both the remote and local ref of each name compete, so neither a stale origin nor a stale local copy wins.
  const refs = names.flatMap((name) => [`origin/${name}`, name].map((ref) => ({ name, ref })));
  const resolved = await Promise.all(
    refs.map(async (c) => ((await runGit(cwd, ["rev-parse", "--verify", "-q", `${c.ref}^{commit}`])).ok ? c : null)),
  );
  const existing = resolved.filter((c): c is { name: string; ref: string } => c !== null);
  const fallback = existing[0] ?? { name: defaultBranch || "main", ref: defaultBranch || "main" };
  const own = existing.find((c) => c.name === branch);
  if (own) return { base: own.name, baseRef: own.ref };
  if (!hasHead || existing.length < 2) return { base: fallback.name, baseRef: fallback.ref };

  const scored = await Promise.all(
    existing.map(async (c) => {
      const [ahead, behind] = await Promise.all([
        runGit(cwd, ["rev-list", "--count", `${c.ref}..HEAD`]),
        runGit(cwd, ["rev-list", "--count", `HEAD..${c.ref}`]),
      ]);
      const aheadCount = ahead.ok ? Number(ahead.stdout.trim()) : Number.POSITIVE_INFINITY;
      // A ref that already holds every HEAD commit and more has merged this branch; it isn't where it forked from.
      const mergedIn = aheadCount === 0 && behind.ok && Number(behind.stdout.trim()) > 0;
      return { ...c, ahead: aheadCount, mergedIn };
    }),
  );
  const pool = scored.some((c) => !c.mergedIn) ? scored.filter((c) => !c.mergedIn) : scored;
  const best = pool.reduce((a, b) => (b.ahead < a.ahead ? b : a));
  return { base: best.name, baseRef: best.ref };
}

function mapStatusChar(code: string): ChangeKind {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

function isSyntheticGalleryAgent(agentId: string): boolean {
  return agentId === "gallery" || agentId.startsWith("thr_");
}

function demoChanges(target: ChangesTarget, filter: readonly string[] | null): ChangesResult {
  const allFiles: ChangedFile[] = [
    {
      path: "src/worker/retry.ts",
      previousPath: null,
      kind: "modified",
      additions: 28,
      deletions: 6,
      untracked: false,
      diff: "inline",
    },
    {
      path: "src/worker/retry.test.ts",
      previousPath: null,
      kind: "added",
      additions: 54,
      deletions: 0,
      untracked: false,
      diff: "inline",
    },
    {
      path: "src/config/limits.ts",
      previousPath: null,
      kind: "modified",
      additions: 4,
      deletions: 2,
      untracked: false,
      diff: "inline",
    },
  ];
  const files = allFiles.filter((file) => matchesPathFilter(file.path, filter));
  const patches: FilePatch[] = [
    {
      path: "src/worker/retry.ts",
      patch: `@@ -14,6 +14,12 @@ export async function scheduleRetry(job: Job, status: number) {\n-  const waitMs = Math.min(30_000, 1_000 * 2 ** job.attempt);\n+  const retryAfter = job.headers?.["retry-after"];\n+  const parsed = retryAfter ? Number(retryAfter) * 1_000 : NaN;\n+  const waitMs = Number.isFinite(parsed)\n+    ? Math.min(60_000, Math.max(1_000, parsed))\n+    : Math.min(30_000, 1_000 * 2 ** job.attempt);\n   await queue.delay(job.id, waitMs);\n }`,
      truncated: false,
    },
    {
      path: "src/worker/retry.test.ts",
      patch: `@@ -0,0 +1,12 @@\n+import { describe, expect, it } from "vitest";\n+import { scheduleRetry } from "./retry";\n+\n+describe("scheduleRetry", () => {\n+  it("respects Retry-After on 429 responses", async () => {\n+    const delay = await scheduleRetry({ id: "j_1", attempt: 1, headers: { "retry-after": "8" } }, 429);\n+    expect(delay).toBe(8_000);\n+  });\n+});`,
      truncated: false,
    },
    {
      path: "src/config/limits.ts",
      patch: `@@ -4,2 +4,4 @@\n-export const MAX_RETRY_MS = 30_000;\n+export const MAX_RETRY_MS = 60_000;\n+export const MIN_RETRY_MS = 1_000;`,
      truncated: false,
    },
  ];
  const scope: ChangesScope =
    target.kind === "commit"
      ? { kind: "commit", sha: target.sha, subject: "Honour Retry-After on 429" }
      : target.kind === "uncommitted"
        ? { kind: "uncommitted", branch: "feat/retry-after", unborn: false }
        : { kind: "branch", branch: "feat/retry-after", head: "a4f91c2", base: "main", onBase: false };
  return {
    ok: true,
    scope,
    files,
    totalFiles: allFiles.length,
    filter,
    listTruncated: false,
    patches: patches.filter((p) => files.some((f) => f.path === p.path)),
    livePatches: true,
    takenAt: Date.now(),
    stored: false,
  };
}

function demoCommits(): CommitsResult {
  const now = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    branch: "feat/retry-after",
    checkout: "branch",
    head: "a4f91c2",
    base: "main",
    onBase: false,
    ahead: 3,
    behind: 0,
    commits: [
      {
        sha: "a4f91c28b019e4321c98d71a0e92341b87c65120",
        shortSha: "a4f91c2",
        subject: "Cover Retry-After header parsing in worker tests",
        author: "Ada Lovelace",
        authoredAt: now - 900,
      },
      {
        sha: "7b3d08e912a4f50c11e9823a4b5c6d7e8f901234",
        shortSha: "7b3d08e",
        subject: "Honour Retry-After header on 429 responses",
        author: "Ada Lovelace",
        authoredAt: now - 2400,
      },
      {
        sha: "1c8e44a092b3d18f7e6a5c4b3a291807f6e5d4c3",
        shortSha: "1c8e44a",
        subject: "Raise max retry cap to 60s",
        author: "Ada Lovelace",
        authoredAt: now - 5400,
      },
    ],
    commitsTruncated: false,
    takenAt: Date.now(),
    stored: false,
  };
}

function demoPullRequest(): PullRequestResult {
  return {
    ok: true,
    branch: "feat/retry-after",
    pullRequest: {
      number: 142,
      title: "Honour Retry-After on 429 worker responses",
      url: "https://github.com/acme/worker/pull/142",
      state: "open",
      baseRef: "main",
      headRef: "feat/retry-after",
      checks: {
        state: "passing",
        passed: 6,
        failed: 0,
        pending: 0,
        total: 6,
      },
      review: {
        state: "approved",
        requests: 0,
      },
      mergeability: "mergeable",
      attention: "ready_to_merge",
      autoMerge: false,
      inMergeQueue: false,
      updatedAt: Date.now() - 600_000,
    },
    fetchedAt: Date.now(),
  };
}

function demoThreads(ids: readonly string[] | null): ThreadsResult {
  const sample: ThreadInfo[] = [
    {
      found: true,
      id: "thr_worker_tests",
      title: "Verify retry backoff edge cases",
      status: "idle",
      needsInput: false,
      archived: false,
      provider: { id: "claude", name: "Claude Code", logoUrl: null },
      model: "claude-sonnet-4-6",
      reasoning: "high",
      updatedAt: Date.now() - 300_000,
      lastMessage: {
        text: "All 14 retry backoff tests pass, including malformed Retry-After headers.",
        truncated: false,
      },
      pending: null,
      runningWorkers: 0,
    },
    {
      found: true,
      id: "thr_worker_bench",
      title: "Benchmark queue throughput under 429 storms",
      status: "active",
      needsInput: false,
      archived: false,
      provider: { id: "codex", name: "Codex", logoUrl: null },
      model: "gpt-5.4",
      reasoning: "medium",
      updatedAt: Date.now() - 45_000,
      lastMessage: {
        text: "Running hyperfine across 1,000 synthetic 429 jobs...",
        truncated: false,
      },
      pending: null,
      runningWorkers: 1,
    },
  ];
  return {
    ok: true,
    mode: ids === null ? "subthreads" : "ids",
    threads: sample,
    truncated: false,
    fetchedAt: Date.now(),
  };
}

function demoEnvironments(): EnvironmentsResult {
  const now = Date.now();
  const envs: EnvironmentInfo[] = [
    {
      id: "env_main",
      name: "retry-after",
      kind: "managed-worktree",
      provider: "git-worktree",
      path: "/workspace/worker-retry-after",
      branch: "feat/retry-after",
      defaultBranch: "main",
      base: "main",
      git: true,
      life: "ready",
      current: true,
      threads: [
        {
          id: "thr_1",
          title: "Honour Retry-After on 429",
          status: "idle",
          needsInput: false,
          archived: false,
          subthread: false,
          activeAt: now - 120_000,
        },
      ],
      threadCounts: { total: 1, live: 1, running: 0, needsInput: 0 },
      activeAt: now - 120_000,
      updatedAt: now - 120_000,
      detail: {
        ok: true,
        id: "env_main",
        checkout: {
          ok: true,
          branch: "feat/retry-after",
          checkout: "branch",
          head: "a4f91c2",
          defaultBranch: "main",
          base: "main",
          onBase: false,
          ahead: 3,
          behind: 0,
          uncommitted: { files: 3, additions: 86, deletions: 8, complete: true },
        },
        pull: {
          ok: true,
          pullRequest: {
            number: 142,
            title: "Honour Retry-After on 429 worker responses",
            url: "https://github.com/acme/worker/pull/142",
            state: "open",
            baseRef: "main",
            headRef: "feat/retry-after",
            checks: { state: "passing", passed: 6, failed: 0, pending: 0, total: 6 },
            review: { state: "approved", requests: 0 },
            mergeability: "mergeable",
            attention: "ready_to_merge",
            autoMerge: false,
            inMergeQueue: false,
            updatedAt: now - 600_000,
          },
        },
        fetchedAt: now,
      },
    },
    {
      id: "env_checkout",
      name: "main",
      kind: "checkout",
      provider: "project-checkout",
      path: "/workspace/worker",
      branch: "main",
      defaultBranch: "main",
      base: "main",
      git: true,
      life: "ready",
      current: false,
      threads: [],
      threadCounts: { total: 0, live: 0, running: 0, needsInput: 0 },
      activeAt: null,
      updatedAt: now - 3_600_000,
      detail: {
        ok: true,
        id: "env_checkout",
        checkout: {
          ok: true,
          branch: "main",
          checkout: "branch",
          head: "9f12bc4",
          defaultBranch: "main",
          base: "main",
          onBase: true,
          ahead: null,
          behind: null,
          uncommitted: { files: 0, additions: 0, deletions: 0, complete: true },
        },
        pull: null,
        fetchedAt: now,
      },
    },
  ];
  return {
    ok: true,
    environments: envs,
    threadsTruncated: false,
    fetchedAt: now,
  };
}

export async function readProjectChanges(
  paseo: PaseoApi,
  agentId: string,
  rawTarget: string | null,
  rawPaths: readonly string[] | null,
): Promise<ChangesResult> {
  const parsedTarget = parseChangesTarget(rawTarget);
  if (!parsedTarget.ok) return failure("invalid", parsedTarget.error);
  const parsedPaths = parsePathFilter(rawPaths);
  if (!parsedPaths.ok) return failure("invalid", parsedPaths.error);
  const target = parsedTarget.value;
  const filter = parsedPaths.value;

  if (isSyntheticGalleryAgent(agentId)) return demoChanges(target, filter);

  const cwd = await resolveAgentCwd(paseo, agentId);
  if (!cwd) return demoChanges(target, filter);

  const gitInfo = await detectGitBranches(cwd);
  if (!gitInfo.ok) return gitInfo;

  let diffArgs: string[];
  let numstatArgs: string[];
  let scope: ChangesScope;

  if (target.kind === "commit") {
    const subj = await runGit(cwd, ["show", "-s", "--format=%s", target.sha]);
    scope = {
      kind: "commit",
      sha: target.sha,
      subject: subj.ok ? subj.stdout.trim() || null : null,
    };
    diffArgs = ["show", "--format=", "--unified=3", target.sha];
    numstatArgs = ["show", "--format=", "--numstat", "--find-renames", target.sha];
  } else if (target.kind === "uncommitted" || gitInfo.checkout === "unborn" || gitInfo.branch === gitInfo.base) {
    scope =
      target.kind === "uncommitted" || gitInfo.checkout === "unborn"
        ? { kind: "uncommitted", branch: gitInfo.branch, unborn: gitInfo.checkout === "unborn" }
        : { kind: "branch", branch: gitInfo.branch, head: gitInfo.head, base: gitInfo.base, onBase: true };
    diffArgs = ["diff", "HEAD", "--unified=3"];
    numstatArgs = ["diff", "HEAD", "--numstat", "--find-renames"];
  } else {
    scope = {
      kind: "branch",
      branch: gitInfo.branch,
      head: gitInfo.head,
      base: gitInfo.base,
      onBase: false,
    };
    diffArgs = ["diff", `${gitInfo.baseRef}...HEAD`, "--unified=3"];
    numstatArgs = ["diff", `${gitInfo.baseRef}...HEAD`, "--numstat", "--find-renames"];
  }

  const [numstatRes, nameStatusRes, patchRes] = await Promise.all([
    runGit(cwd, numstatArgs),
    runGit(cwd, [numstatArgs[0]!, ...numstatArgs.slice(1).map((a) => (a === "--numstat" ? "--name-status" : a))]),
    runGit(cwd, diffArgs),
  ]);

  if (!numstatRes.ok) return failure("unavailable", numstatRes.error);

  const kindByPath = new Map<string, { kind: ChangeKind; previousPath: string | null }>();
  if (nameStatusRes.ok) {
    for (const line of nameStatusRes.stdout.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const code = parts[0] ?? "M";
      if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
        kindByPath.set(parts[2]!, { kind: mapStatusChar(code), previousPath: parts[1]! });
      } else if (parts[1]) {
        kindByPath.set(parts[1], { kind: mapStatusChar(code), previousPath: null });
      }
    }
  }

  const allFiles: ChangedFile[] = [];
  for (const line of numstatRes.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [addStr, delStr, rawPath] = line.split("\t");
    if (!rawPath) continue;
    const binary = addStr === "-" || delStr === "-";
    const additions = binary ? 0 : Number(addStr) || 0;
    const deletions = binary ? 0 : Number(delStr) || 0;
    const meta = kindByPath.get(rawPath) ?? { kind: "modified" as const, previousPath: null };
    allFiles.push({
      path: rawPath,
      previousPath: meta.previousPath,
      kind: meta.kind,
      additions,
      deletions,
      untracked: false,
      diff: binary ? "binary" : "inline",
    });
  }

  const files = allFiles.filter(
    (f) => matchesPathFilter(f.path, filter) || (f.previousPath !== null && matchesPathFilter(f.previousPath, filter)),
  );
  const patches = parseUnifiedPatches(patchRes.ok ? patchRes.stdout : "").filter((p) =>
    files.some((f) => f.path === p.path),
  );

  return {
    ok: true,
    scope,
    files,
    totalFiles: allFiles.length,
    filter,
    listTruncated: false,
    patches,
    livePatches: true,
    takenAt: Date.now(),
    stored: false,
  };
}

function parseUnifiedPatches(rawDiff: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const chunks = rawDiff.split(/^diff --git /m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const lines = chunk.split("\n");
    const header = lines[0] ?? "";
    const match = / b\/(.+)$/.exec(header);
    const filePath = match?.[1]?.trim();
    if (!filePath) continue;
    const hunkStart = lines.findIndex((line) => line.startsWith("@@ "));
    if (hunkStart === -1) continue;
    patches.push({
      path: filePath,
      patch: lines.slice(hunkStart).join("\n").trimEnd(),
      truncated: false,
    });
  }
  return patches;
}

export async function readProjectPatches(
  paseo: PaseoApi,
  agentId: string,
  rawTarget: string | null,
  paths: readonly string[],
): Promise<PatchesResult> {
  const changes = await readProjectChanges(paseo, agentId, rawTarget, paths);
  if (!changes.ok) return changes;
  return { ok: true, patches: changes.patches };
}

export async function readProjectCommits(paseo: PaseoApi, agentId: string): Promise<CommitsResult> {
  if (isSyntheticGalleryAgent(agentId)) return demoCommits();
  const cwd = await resolveAgentCwd(paseo, agentId);
  if (!cwd) return demoCommits();

  const gitInfo = await detectGitBranches(cwd);
  if (!gitInfo.ok) return gitInfo;

  const onBase = gitInfo.branch === gitInfo.base;
  const range = onBase ? `-n ${MAX_COMMITS}` : `${gitInfo.baseRef}..HEAD`;
  const logArgs = onBase
    ? ["log", `-n`, String(MAX_COMMITS), "--format=%H%x09%h%x09%s%x09%an%x09%at"]
    : ["log", range, "--format=%H%x09%h%x09%s%x09%an%x09%at"];
  const logRes = await runGit(cwd, logArgs);
  const commits = (logRes.ok ? logRes.stdout.split("\n") : [])
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [sha = "", shortSha = "", subject = "", author = "", authoredAtStr = "0"] = line.split("\t");
      return {
        sha,
        shortSha,
        subject,
        author,
        authoredAt: Number(authoredAtStr) || 0,
      };
    });

  let ahead: number | null = null;
  let behind: number | null = null;
  if (!onBase) {
    const counts = await runGit(cwd, ["rev-list", "--left-right", "--count", `${gitInfo.baseRef}...HEAD`]);
    if (counts.ok) {
      const [bStr, aStr] = counts.stdout.trim().split(/\s+/);
      behind = Number(bStr) || 0;
      ahead = Number(aStr) || 0;
    }
  }

  return {
    ok: true,
    branch: gitInfo.branch,
    checkout: gitInfo.checkout,
    head: gitInfo.head,
    base: gitInfo.base,
    onBase,
    ahead,
    behind,
    commits: commits.slice(0, MAX_COMMITS),
    commitsTruncated: commits.length > MAX_COMMITS,
    takenAt: Date.now(),
    stored: false,
  };
}

export async function readProjectPullRequest(paseo: PaseoApi, agentId: string): Promise<PullRequestResult> {
  if (isSyntheticGalleryAgent(agentId)) return demoPullRequest();
  const cwd = await resolveAgentCwd(paseo, agentId);
  if (!cwd) return demoPullRequest();

  const gitInfo = await detectGitBranches(cwd);
  if (!gitInfo.ok) return gitInfo;

  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        "--json",
        "number,title,url,state,isDraft,baseRefName,headRefName,reviewDecision,reviewRequests,mergeStateStatus,statusCheckRollup,updatedAt,autoMergeRequest",
      ],
      { cwd, timeout: 10_000 },
    );
    const pr = JSON.parse(stdout) as Record<string, unknown>;
    const rawState = String(pr.state ?? "OPEN").toUpperCase();
    const state: PullRequestInfo["state"] =
      rawState === "MERGED" ? "merged" : rawState === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
    const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    let passed = 0;
    let failed = 0;
    let pending = 0;
    for (const check of rollup) {
      if (typeof check !== "object" || check === null) continue;
      const c = check as Record<string, unknown>;
      const conclusion = String(c.conclusion ?? c.state ?? "").toUpperCase();
      if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") passed++;
      else if (conclusion === "FAILURE" || conclusion === "ERROR" || conclusion === "TIMED_OUT") failed++;
      else pending++;
    }
    const total = passed + failed + pending;
    const checksState: PullRequestInfo["checks"]["state"] =
      total === 0 ? "no_checks" : failed > 0 ? "failing" : pending > 0 ? "pending" : "passing";
    const decision = String(pr.reviewDecision ?? "").toUpperCase();
    const reviewRequests = Array.isArray(pr.reviewRequests) ? pr.reviewRequests.length : 0;
    const reviewState: PullRequestInfo["review"]["state"] =
      decision === "APPROVED"
        ? "approved"
        : decision === "CHANGES_REQUESTED"
          ? "changes_requested"
          : reviewRequests > 0
            ? "review_requested"
            : decision === "REVIEW_REQUIRED"
              ? "review_required"
              : "none";
    const mergeStatus = String(pr.mergeStateStatus ?? "").toUpperCase();
    const mergeability: PullRequestInfo["mergeability"] =
      mergeStatus === "CLEAN" || mergeStatus === "HAS_HOOKS"
        ? "mergeable"
        : mergeStatus === "DIRTY"
          ? "conflicts"
          : mergeStatus === "BLOCKED"
            ? "blocked"
            : "unknown";
    const attention: PullRequestInfo["attention"] =
      state === "merged"
        ? "merged"
        : state === "closed"
          ? "closed"
          : state === "draft"
            ? "draft"
            : mergeability === "conflicts"
              ? "conflicts"
              : checksState === "failing"
                ? "checks_failed"
                : reviewState === "changes_requested"
                  ? "changes_requested"
                  : reviewState === "approved" && checksState === "passing"
                    ? "ready_to_merge"
                    : "review_requested";

    return {
      ok: true,
      branch: gitInfo.branch,
      pullRequest: {
        number: Number(pr.number) || 0,
        title: String(pr.title ?? ""),
        url: String(pr.url ?? ""),
        state,
        baseRef: String(pr.baseRefName ?? gitInfo.base),
        headRef: String(pr.headRefName ?? gitInfo.branch ?? ""),
        checks: { state: checksState, passed, failed, pending, total },
        review: { state: reviewState, requests: reviewRequests },
        mergeability,
        attention,
        autoMerge: Boolean(pr.autoMergeRequest),
        inMergeQueue: false,
        updatedAt: typeof pr.updatedAt === "string" ? Date.parse(pr.updatedAt) : null,
      },
      fetchedAt: Date.now(),
    };
  } catch {
    return {
      ok: true,
      branch: gitInfo.branch,
      pullRequest: null,
      fetchedAt: Date.now(),
    };
  }
}

function mapAgentStatus(status: string): ThreadDisplayStatus {
  if (status === "running") return "active";
  if (status === "initializing") return "starting";
  if (status === "error") return "error";
  return "idle";
}

function parentAgentOf(agent: { runtimeInfo?: unknown; labels?: Record<string, string> }): string | null {
  if (agent.labels && typeof agent.labels.parentAgentId === "string") {
    return agent.labels.parentAgentId;
  }
  const rt = agent.runtimeInfo;
  if (typeof rt === "object" && rt !== null && "parentAgentId" in rt) {
    const val = (rt as { parentAgentId?: unknown }).parentAgentId;
    if (typeof val === "string") return val;
  }
  return null;
}

export async function readProjectThreads(
  paseo: PaseoApi,
  agentId: string,
  ids: readonly string[] | null,
): Promise<ThreadsResult> {
  if (isSyntheticGalleryAgent(agentId)) return demoThreads(ids);
  try {
    const { entries } = await paseo.agents.list();
    const byId = new Map(entries.map((entry) => [entry.agent.id, entry.agent]));
    const own = byId.get(agentId) ?? null;
    const targetAgents =
      ids === null
        ? entries
            .map((e) => e.agent)
            .filter((a) => {
              const p = parentAgentOf(a);
              if (p === agentId) return true;
              return own !== null && a.workspaceId === own.workspaceId && a.id !== agentId;
            })
        : ids.map((id) => byId.get(id) ?? null);

    const threads: (ThreadInfo | MissingThread)[] = await Promise.all(
      targetAgents.map(async (agent, index): Promise<ThreadInfo | MissingThread> => {
        if (!agent) {
          return { found: false as const, id: ids?.[index] ?? "unknown" };
        }
        let latestText: string | null = null;
        try {
          const tl = await paseo.agents.ref(agent.id).timeline.refetch({ limit: 10 });
          for (let i = tl.entries.length - 1; i >= 0; i--) {
            const entry = tl.entries[i];
            if (entry && entry.item.type === "assistant_message") {
              latestText = entry.item.text;
              break;
            }
          }
        } catch {
          // Ignore timeline fetch error
        }
        const requiresAttention = Boolean(agent.requiresAttention);
        return {
          found: true as const,
          id: agent.id,
          title: agent.title?.trim() || `Agent ${agent.id.slice(0, 8)}`,
          status: mapAgentStatus(agent.status),
          needsInput: requiresAttention && agent.attentionReason === "permission",
          archived: Boolean(agent.archivedAt),
          provider: { id: agent.provider, name: agent.provider, logoUrl: null },
          model: agent.model ?? null,
          reasoning: agent.thinkingOptionId ?? null,
          updatedAt: Date.parse(agent.updatedAt) || Date.now(),
          lastMessage: lastMessage(latestText),
          pending: null,
          runningWorkers: 0,
        };
      }),
    );

    return {
      ok: true,
      mode: ids === null ? "subthreads" : "ids",
      threads,
      truncated: false,
      fetchedAt: Date.now(),
    };
  } catch (cause) {
    return failure("unavailable", cause instanceof Error ? cause.message : String(cause));
  }
}

export async function readProjectEnvironments(
  paseo: PaseoApi,
  agentId: string,
  withDetails: boolean,
): Promise<EnvironmentsResult> {
  if (isSyntheticGalleryAgent(agentId)) return demoEnvironments();
  try {
    const [workspacesRes, agentsRes] = await Promise.all([
      paseo.workspaces.list(),
      paseo.agents.list(),
    ]);
    const ownAgent = agentsRes.entries.find((e) => e.agent.id === agentId)?.agent ?? null;
    const ownWorkspace =
      workspacesRes.entries.find((w) => w.id === ownAgent?.workspaceId) ??
      workspacesRes.entries[0] ??
      null;
    if (!ownWorkspace) return demoEnvironments();

    const projectWorkspaces = workspacesRes.entries.filter(
      (w) => w.projectId === ownWorkspace.projectId,
    );
    const environments: EnvironmentInfo[] = await Promise.all(
      projectWorkspaces.map(async (ws): Promise<EnvironmentInfo> => {
        const wsAgents = agentsRes.entries
          .map((e) => e.agent)
          .filter((a) => a.workspaceId === ws.id);
        const threads: EnvironmentThread[] = wsAgents.slice(0, 5).map((a) => ({
          id: a.id,
          title: a.title?.trim() || `Agent ${a.id.slice(0, 8)}`,
          status: mapAgentStatus(a.status),
          needsInput: Boolean(a.requiresAttention) && a.attentionReason === "permission",
          archived: Boolean(a.archivedAt),
          subthread: parentAgentOf(a) !== null,
          activeAt: Date.parse(a.updatedAt) || Date.now(),
        }));
        const live = threads.filter((t) => !t.archived);
        const dir = ws.workspaceDirectory;
        const gitInfo = dir ? await detectGitBranches(dir) : null;
        const branch = gitInfo && gitInfo.ok ? gitInfo.branch : null;
        const base = gitInfo && gitInfo.ok ? gitInfo.base : "main";
        const detail = withDetails ? await readWorkspaceDetail(ws.id, dir) : null;
        return {
          id: ws.id,
          name: ws.title ?? ws.id,
          kind: ws.workspaceKind === "worktree" ? "managed-worktree" : "checkout",
          provider: ws.workspaceKind,
          path: dir,
          branch,
          defaultBranch: base,
          base,
          git: ws.projectKind === "git",
          life: ws.archivingAt ? "retiring" : "ready",
          current: ws.id === ownWorkspace.id,
          threads,
          threadCounts: {
            total: wsAgents.length,
            live: live.length,
            running: live.filter((t) => t.status === "active").length,
            needsInput: live.filter((t) => t.needsInput).length,
          },
          activeAt: threads[0]?.activeAt ?? null,
          updatedAt: Date.now(),
          detail,
        };
      }),
    );

    return {
      ok: true,
      environments,
      threadsTruncated: false,
      fetchedAt: Date.now(),
    };
  } catch (cause) {
    return failure("unavailable", cause instanceof Error ? cause.message : String(cause));
  }
}

async function readWorkspaceDetail(
  workspaceId: string,
  directory: string | null,
): Promise<EnvironmentDetail> {
  if (!directory) {
    return {
      ok: true,
      id: workspaceId,
      checkout: {
        ok: false,
        reason: "missing",
        message: "Workspace directory is unavailable",
        path: null,
      },
      pull: null,
      fetchedAt: Date.now(),
    };
  }
  const gitInfo = await detectGitBranches(directory);
  if (!gitInfo.ok) {
    return {
      ok: true,
      id: workspaceId,
      checkout: { ok: false, reason: "not-git", message: gitInfo.message, path: directory },
      pull: null,
      fetchedAt: Date.now(),
    };
  }
  const statusRes = await runGit(directory, ["status", "--porcelain"]);
  const changedLines = statusRes.ok
    ? statusRes.stdout.split("\n").filter((l) => l.trim() !== "")
    : [];
  return {
    ok: true,
    id: workspaceId,
    checkout: {
      ok: true,
      branch: gitInfo.branch,
      checkout: gitInfo.checkout,
      head: gitInfo.head,
      defaultBranch: gitInfo.base,
      base: gitInfo.base,
      onBase: gitInfo.branch === gitInfo.base,
      ahead: null,
      behind: null,
      uncommitted: {
        files: changedLines.length,
        additions: 0,
        deletions: 0,
        complete: true,
      },
    },
    pull: null,
    fetchedAt: Date.now(),
  };
}

export async function readProjectEnvironment(
  paseo: PaseoApi,
  agentId: string,
  environmentId: string,
): Promise<EnvironmentDetailResult> {
  if (isSyntheticGalleryAgent(agentId) || environmentId.startsWith("env_")) {
    const demo = demoEnvironments();
    if (demo.ok) {
      const match = demo.environments.find((e) => e.id === environmentId) ?? demo.environments[0];
      if (match?.detail) return match.detail;
    }
  }
  const workspaces = await paseo.workspaces.list();
  const ws = workspaces.entries.find((w) => w.id === environmentId);
  if (!ws) return { ok: false, reason: "not-found", message: "Workspace not found" };
  return readWorkspaceDetail(ws.id, ws.workspaceDirectory);
}

export function createProjectReader(
  paseo: PaseoApi,
  agentId: string,
): (request: ProjectRequest) => Promise<ProjectResult> {
  return (request) => {
    switch (request.kind) {
      case "changes":
        return readProjectChanges(
          paseo,
          agentId,
          request.target.kind === "commit"
            ? request.target.sha
            : request.target.kind === "uncommitted"
              ? "uncommitted"
              : null,
          request.paths,
        );
      case "commits":
        return readProjectCommits(paseo, agentId);
      case "pullRequest":
        return readProjectPullRequest(paseo, agentId);
      case "threads":
        return readProjectThreads(paseo, agentId, request.ids);
      case "environments":
        return readProjectEnvironments(paseo, agentId, true);
    }
  };
}
