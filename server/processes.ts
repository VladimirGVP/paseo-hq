import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import type { MemoryProcess, MemoryTop } from "../shared/stats";

const execFileAsync = promisify(execFile);
const PAGE_BYTES = 4096;
const TOP_LIMIT = 7;
const INTERPRETERS = new Set(["node", "python", "python3", "bun", "deno", "ruby", "php", "bash", "sh"]);

interface CachedMeta {
  label: string;
  scope: string | null;
}

function sanitizeToken(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_./@ -]+/g, "").trim().slice(0, 36);
}

function classifyLinuxProcess(comm: string, cmdline: string, cgroup: string): CachedMeta {
  const args = cmdline.split("\0").filter(Boolean);
  const exe = basename(args[0] || comm || "process");
  let label = comm || exe;

  if (exe === "node" && args.some((a) => a.endsWith("/plugins/plugin-process.js"))) {
    label = "Paseo plugin worker";
  } else if (exe === "node" && args.some((a) => a.endsWith("/terminal-worker.mjs"))) {
    label = "Paseo terminal worker";
  } else if (comm === "Paseo Daemon" || args[0] === "Paseo Daemon") {
    label = "Paseo Daemon";
  } else if (comm.startsWith("Paseo Superviso") || args[0] === "Paseo Supervisor") {
    label = "Paseo Supervisor";
  } else if (exe === "node" && args.some((a) => a.endsWith("/paseo") || a === "paseo") && args.includes("daemon")) {
    label = "paseo daemon";
  } else if (exe === "agy") {
    label = args[1] === "acp" ? "Antigravity (agy acp)" : "Antigravity (agy)";
  } else if (exe === "codex" || args[0]?.includes("@openai/codex")) {
    label = args.includes("app-server") ? "Codex app-server" : "Codex CLI";
  } else if (exe === "claude") {
    label = "Claude CLI";
  } else if (INTERPRETERS.has(exe)) {
    const script = args
      .slice(1)
      .find((a) => !a.startsWith("-") && !a.includes("=") && (a.includes("/") || /\.(m?js|cjs|ts|py|sh)$/.test(a)));
    if (script) {
      const file = sanitizeToken(basename(script));
      const dir = sanitizeToken(basename(dirname(script)));
      label = dir && dir !== "." && dir !== "bin" ? `${exe} (${dir}/${file})` : `${exe} (${file})`;
    } else {
      label = sanitizeToken(exe) || "process";
    }
  } else {
    const candidate = exe.length >= comm.length && !exe.includes(" ") ? exe : comm;
    label = sanitizeToken(candidate) || "process";
  }

  let scope: string | null = null;
  const lxc = /lxc\.payload\.([A-Za-z0-9_.-]+)/.exec(cgroup);
  if (lxc?.[1]) scope = lxc[1];
  else if (cgroup.includes("/docker/")) scope = "docker";

  return { label, scope };
}

interface RawProc {
  pid: number;
  label: string;
  scope: string | null;
  rssBytes: number;
  anonBytes: number;
  sharedBytes: number;
}

function aggregateProcesses(procs: RawProc[]): MemoryTop {
  const byPid: MemoryProcess[] = [...procs]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, TOP_LIMIT)
    .map((p) => ({
      pid: p.pid,
      label: p.label,
      scope: p.scope,
      count: 1,
      bytes: p.rssBytes,
      rssBytes: p.rssBytes,
    }));

  const groups = new Map<
    string,
    {
      pid: number;
      maxRss: number;
      label: string;
      scope: string | null;
      count: number;
      anonBytes: number;
      maxSharedBytes: number;
      rssBytes: number;
    }
  >();

  for (const p of procs) {
    const key = `${p.label}\0${p.scope ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        pid: p.pid,
        maxRss: p.rssBytes,
        label: p.label,
        scope: p.scope,
        count: 0,
        anonBytes: 0,
        maxSharedBytes: 0,
        rssBytes: 0,
      };
      groups.set(key, g);
    }
    g.count += 1;
    g.anonBytes += p.anonBytes;
    if (p.sharedBytes > g.maxSharedBytes) g.maxSharedBytes = p.sharedBytes;
    g.rssBytes += p.rssBytes;
    if (p.rssBytes > g.maxRss) {
      g.maxRss = p.rssBytes;
      g.pid = p.pid;
    }
  }

  const byGroup: MemoryProcess[] = [...groups.values()]
    .map((g) => ({
      pid: g.pid,
      label: g.label,
      scope: g.scope,
      count: g.count,
      bytes: g.anonBytes + g.maxSharedBytes,
      rssBytes: g.rssBytes,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, TOP_LIMIT);

  return { byGroup, byPid };
}

export function createMemoryProcessReader(): () => Promise<MemoryTop> {
  const metaCache = new Map<string, CachedMeta>();

  if (process.platform === "darwin") {
    return async () => {
      try {
        const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,rss=,comm="], { timeout: 1500 });
        const procs: RawProc[] = [];
        for (const line of stdout.split("\n")) {
          const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
          if (!m) continue;
          const pid = Number(m[1]);
          const rssBytes = Number(m[2]) * 1024;
          if (!pid || rssBytes <= 0) continue;
          const label = sanitizeToken(basename(m[3]!.trim())) || "process";
          procs.push({ pid, label, scope: null, rssBytes, anonBytes: rssBytes, sharedBytes: 0 });
        }
        return aggregateProcesses(procs);
      } catch {
        return { byGroup: [], byPid: [] };
      }
    };
  }

  return async () => {
    try {
      const procs: RawProc[] = [];
      const seen = new Set<string>();
      for (const entry of readdirSync("/proc")) {
        const ch = entry.charCodeAt(0);
        if (ch < 48 || ch > 57) continue;
        const pid = Number(entry);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try {
          const statm = readFileSync(`/proc/${entry}/statm`, "ascii");
          const s1 = statm.indexOf(" ");
          const s2 = statm.indexOf(" ", s1 + 1);
          const rssPages = Number(statm.slice(s1 + 1, s2));
          if (!rssPages || rssPages <= 0) continue;
          const s3 = statm.indexOf(" ", s2 + 1);
          const sharedPages = Number(statm.slice(s2 + 1, s3 === -1 ? statm.length : s3)) || 0;

          const comm = readFileSync(`/proc/${entry}/comm`, "utf8").trim();
          const cacheKey = `${entry}:${comm}`;
          seen.add(cacheKey);
          let meta = metaCache.get(cacheKey);
          if (!meta) {
            let cmdline = "";
            let cgroup = "";
            try {
              cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
            } catch {}
            try {
              cgroup = readFileSync(`/proc/${entry}/cgroup`, "utf8");
            } catch {}
            meta = classifyLinuxProcess(comm, cmdline, cgroup);
            metaCache.set(cacheKey, meta);
          }

          const rssBytes = rssPages * PAGE_BYTES;
          const sharedBytes = Math.min(rssPages, Math.max(0, sharedPages)) * PAGE_BYTES;
          const anonBytes = rssBytes - sharedBytes;
          procs.push({
            pid,
            label: meta.label,
            scope: meta.scope,
            rssBytes,
            anonBytes,
            sharedBytes,
          });
        } catch {
          // Process exited mid-scan.
        }
      }
      for (const key of metaCache.keys()) {
        if (!seen.has(key)) metaCache.delete(key);
      }
      return aggregateProcesses(procs);
    } catch {
      return { byGroup: [], byPid: [] };
    }
  };
}
