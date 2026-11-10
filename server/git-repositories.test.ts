import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const commands = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const { promisify } = await import("node:util");
  const execFile = Object.assign(() => { throw new Error("Use the promisified command boundary"); }, {
    [promisify.custom]: async (file: string, args: string[]) => ({ stdout: await commands(file, args), stderr: "" }),
  });
  return { ...original, execFile };
});
import { RepoCacheService } from "./git-cache.server";
import { fetchGitHubRepos, fetchGitLabRepos } from "./git-service.server";

beforeEach(() => { commands.mockReset(); });
const ghRepo = (name: string) => ({ full_name: name, name: name.split("/").at(-1), html_url: `https://github.com/${name}`, clone_url: `https://github.com/${name}.git`, ssh_url: `git@github.com:${name}.git`, private: true, default_branch: "develop" });
const glRepo = (name: string) => ({ path_with_namespace: name, name: name.split("/").at(-1), web_url: `https://gitlab.com/${name}`, visibility: "private", default_branch: "main" });

describe("accessible repositories", () => {
  it("includes organization and collaborator repositories after the first page", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hq-git-list-"));
    try {
      commands.mockImplementation((_, args: string[]) => {
        if (args[0] === "repo") return JSON.stringify([{ nameWithOwner: "person/own" }]);
        const endpoint = args.find((arg) => arg.includes("user/repos"));
        if (!endpoint) throw new Error("Unexpected command: " + args.join(" "));
        expect(endpoint).toContain("affiliation=owner,collaborator,organization_member");
        return JSON.stringify(endpoint.includes("page=2") ? [ghRepo("studio/team-project"), ghRepo("partner/shared-project")] : Array.from({ length: 100 }, (_, i) => ghRepo(`person/repo-${i}`)));
      });
      const repos = await fetchGitHubRepos(undefined, base);
      expect(repos).toHaveLength(102);
      expect(repos.find((repo) => repo.fullName === "studio/team-project")).toMatchObject({ provider: "github", isPrivate: true, defaultBranch: "develop" });
    } finally { await rm(base, { recursive: true }); }
  });

  it("loads group projects from every GitLab page", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hq-git-list-"));
    try {
      commands.mockImplementation((_, args: string[]) => {
        const endpoint = args.find((arg) => arg.startsWith("projects?"))!;
        if (!endpoint.includes("per_page=100")) return JSON.stringify([glRepo("person/own")]);
        return JSON.stringify(endpoint.includes("page=2") ? [glRepo("studio/subgroup/project")] : Array.from({ length: 100 }, (_, i) => glRepo(`person/repo-${i}`)));
      });
      const repos = await fetchGitLabRepos(undefined, "https://gitlab.com", base);
      expect(repos).toHaveLength(101);
      expect(repos.at(-1)?.fullName).toBe("studio/subgroup/project");
    } finally { await rm(base, { recursive: true }); }
  });

  it("reports permission/network errors instead of returning an empty successful list", async () => {
    commands.mockRejectedValue(new Error("HTTP 403: organization access denied"));
    await expect(fetchGitHubRepos(undefined, "/tmp")).rejects.toThrow("403");
  });
});

it("replaces a successful cache snapshot and drops repositories from the previous account", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "hq-git-cache-"));
  let user = "person", fail = false, empty = false;
  commands.mockImplementation((file: string, args: string[]) => {
    if (args[1] === "user") return file.endsWith("glab") ? JSON.stringify({ username: "lab-user" }) : user;
    if (args[1]?.startsWith("projects?")) return "[]";
    if (fail) throw new Error("API temporarily unavailable");
    return JSON.stringify(empty ? [] : [ghRepo(`${user}/private`)]);
  });
  const cache = new RepoCacheService(path.join(base, "cache.json"));
  try {
    await cache.syncAll(undefined, base);
    expect((await cache.getRepos({ cloneDir: base })).repos.map((repo) => repo.fullName)).toEqual(["person/private"]);
    empty = true; await cache.syncAll(undefined, base);
    expect((await cache.getRepos({ cloneDir: base })).repos).toEqual([]);
    empty = false; await cache.syncAll(undefined, base);
    user = "another"; fail = true; await cache.syncAll(undefined, base);
    const result = await cache.getRepos({ cloneDir: base });
    expect(result.repos).toEqual([]);
    expect(result.errors.join(" ")).toContain("temporarily unavailable");
  } finally { cache.destroy(); await rm(base, { recursive: true }); }
});
