import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkerActivity, WorkerInfo, WorkerStats } from "../shared/contracts";

export interface WorkerConfig {
  id: string;
  name: string;
  avatar: string;
  role: string;
  container: string;
  user: string;
  activityPath?: string;
  cgroupPath?: string;
}

export const DEFAULT_WORKERS: WorkerConfig[] = [
  {
    id: "alex",
    name: "Алексей",
    avatar: "🧑‍💻",
    role: "Fullstack Agent",
    container: "alex-work",
    user: "alex",
    activityPath: "/run/workers/alex-status.json",
    cgroupPath: "/sys/fs/cgroup/lxc.payload.alex-work",
  },
  {
    id: "sergey",
    name: "Сергей",
    avatar: "👨‍💻",
    role: "DevOps / Infra",
    container: "sergey-work",
    user: "sergey",
    activityPath: "/run/workers/sergey-status.json",
    cgroupPath: "/sys/fs/cgroup/lxc.payload.sergey-work",
  },
];

const previousMap = new Map<string, { at: number; usage: number }>();
const cachedMap = new Map<string, { stats: WorkerStats; at: number }>();

export async function readWorkerStats(worker: WorkerConfig): Promise<WorkerStats> {
  const base = worker.cgroupPath || `/sys/fs/cgroup/lxc.payload.${worker.container}`;
  try {
    const cachedEntry = cachedMap.get(worker.id);
    const prev = previousMap.get(worker.id);
    if (cachedEntry && prev && Date.now() - prev.at >= 0 && Date.now() - prev.at < 1000) {
      return cachedEntry.stats;
    }

    const [cpu, max, memory, limit, pids] = await Promise.all(
      ["cpu.stat", "cpu.max", "memory.current", "memory.max", "pids.current"].map((f) =>
        readFile(`${base}/${f}`, "utf8")
      )
    );

    const usage = Number(/^usage_usec\s+(\d+)/m.exec(cpu!)?.[1]);
    const [quota, period] = max!.trim().split(/\s+/);
    const cores = quota === "max" ? null : Number(quota) / Number(period);
    const mem = Number(memory);
    const memLimit = limit!.trim() === "max" ? null : Number(limit);
    const processes = Number(pids);
    const at = Date.now();

    if (
      !Number.isFinite(usage) ||
      !Number.isFinite(mem) ||
      !Number.isFinite(processes) ||
      (cores !== null && (!Number.isFinite(cores) || cores <= 0)) ||
      (memLimit !== null && (!Number.isFinite(memLimit) || memLimit <= 0))
    ) {
      throw Error("Invalid counters");
    }

    if (prev && at <= prev.at && cachedEntry) return cachedEntry.stats;

    const percent =
      prev && at > prev.at && usage >= prev.usage && cores !== null
        ? Math.min(100, Math.max(0, ((usage - prev.usage) / ((at - prev.at) * 1000 * cores)) * 100))
        : null;

    previousMap.set(worker.id, { at, usage });
    const stats: WorkerStats = {
      available: true,
      cpu: percent,
      cpuLimit: cores,
      memory: mem,
      memoryLimit: memLimit,
      processes,
    };
    cachedMap.set(worker.id, { stats, at });
    return stats;
  } catch {
    previousMap.delete(worker.id);
    cachedMap.delete(worker.id);
    return { available: false, cpu: null, cpuLimit: null, memory: null, memoryLimit: null, processes: null };
  }
}

export async function readWorkerActivity(worker: WorkerConfig): Promise<WorkerActivity> {
  const empty: WorkerActivity = {
    available: false,
    lastSsh: null,
    lastMessage: null,
    agentLast: null,
    agentMs: null,
    coverageComplete: false,
  };

  const activityPath = worker.activityPath || `/run/${worker.container}/status.json`;
  try {
    const raw = await readFile(activityPath, "utf8");
    const d = JSON.parse(raw);
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      available: true,
      lastSsh: num(d.lastSsh),
      lastMessage: num(d.lastMessage),
      agentLast: num(d.agentLast),
      agentMs: num(d.agentMs),
      coverageComplete: d.coverageComplete === true,
    };
  } catch {
    return empty;
  }
}

export function computeWorkerStatus(
  stats: WorkerStats,
  activity: WorkerActivity
): "active" | "idle" | "offline" {
  if (!stats.available) return "offline";
  const now = Date.now();
  const agentRecent = activity.agentLast !== null && now - activity.agentLast < 120000;
  const cpuActive = stats.cpu !== null && stats.cpu > 5;
  if (agentRecent || cpuActive) {
    return "active";
  }
  return "idle";
}

export async function loadWorkerConfigs(): Promise<WorkerConfig[]> {
  const customPath = process.env.PASEO_WORKERS_CONFIG || join(homedir(), ".paseo", "workers.json");
  try {
    const custom = await readFile(customPath, "utf8");
    const parsed = JSON.parse(custom) as WorkerConfig[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallback
  }
  return DEFAULT_WORKERS;
}

export async function readAllWorkers(customConfigs?: WorkerConfig[]): Promise<WorkerInfo[]> {
  const configs = customConfigs || (await loadWorkerConfigs());
  const results = await Promise.all(
    configs.map(async (cfg) => {
      const [stats, activity] = await Promise.all([
        readWorkerStats(cfg),
        readWorkerActivity(cfg),
      ]);
      const status = computeWorkerStatus(stats, activity);
      return {
        id: cfg.id,
        name: cfg.name,
        avatar: cfg.avatar,
        role: cfg.role,
        container: cfg.container,
        user: cfg.user,
        status,
        stats,
        activity,
      };
    })
  );
  return results;
}
