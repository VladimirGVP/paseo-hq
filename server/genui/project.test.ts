import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectGitBranches } from "./project";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): { dir: string; git: (...args: string[]) => void; commit: (name: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), "genui-base-"));
  dirs.push(dir);
  const git = (...args: string[]) => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, stdio: "ignore" });
  };
  const commit = (name: string) => {
    writeFileSync(join(dir, name), name);
    git("add", name);
    git("commit", "-m", name);
  };
  git("init", "-q", "-b", "main");
  commit("root");
  return { dir, git, commit };
}

describe("detectGitBranches", () => {
  it("picks dev for a branch cut from dev, not the default branch", async () => {
    const { dir, git, commit } = repo();
    git("checkout", "-q", "-b", "dev");
    for (const n of ["d1", "d2", "d3"]) commit(n);
    git("checkout", "-q", "-b", "fix/thing");
    commit("mine");
    const info = await detectGitBranches(dir);
    expect(info.ok && info.base).toBe("dev");
  });

  it("keeps main for a branch cut from main", async () => {
    const { dir, git, commit } = repo();
    git("checkout", "-q", "-b", "dev");
    commit("d1");
    git("checkout", "-q", "main");
    git("checkout", "-q", "-b", "fix/thing");
    commit("mine");
    const info = await detectGitBranches(dir);
    expect(info.ok && info.base).toBe("main");
  });

  it("treats dev itself as on its base", async () => {
    const { dir, git, commit } = repo();
    git("checkout", "-q", "-b", "dev");
    commit("d1");
    const info = await detectGitBranches(dir);
    expect(info.ok && info.base).toBe("dev");
  });

  it("uses local dev when it is ahead of a stale origin/dev", async () => {
    const { dir, git, commit } = repo();
    git("checkout", "-q", "-b", "dev");
    git("update-ref", "refs/remotes/origin/dev", "HEAD");
    for (const n of ["d1", "d2", "d3"]) commit(n);
    git("checkout", "-q", "-b", "fix/thing");
    commit("mine");
    const info = await detectGitBranches(dir);
    expect(info.ok && info.baseRef).toBe("dev");
  });

  it("keeps main for a branch from main that is already merged into dev", async () => {
    const { dir, git, commit } = repo();
    git("checkout", "-q", "-b", "fix/thing");
    commit("mine");
    git("checkout", "-q", "-b", "dev", "main");
    commit("d1");
    git("merge", "-q", "--no-ff", "-m", "merge", "fix/thing");
    git("checkout", "-q", "fix/thing");
    const info = await detectGitBranches(dir);
    expect(info.ok && info.base).toBe("main");
  });
});
