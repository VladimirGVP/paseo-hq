import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ServiceRow } from "../shared/services-contracts";
import { loadCatalog } from "./services-catalog.server";

const exec = promisify(execFile);

export function status(p: Record<string, string>, scheduled: boolean): string {
  if (p.LoadState === "not-found") return "Не установлена";
  if (p.ActiveState === "failed" || (p.Result && p.Result !== "success")) return "Ошибка";
  if (p.ActiveState === "activating" || (p.ActiveState === "active" && p.SubState === "running")) return "Работает";
  if (p.ActiveState === "active" && p.SubState === "exited") return "Активна";
  if (scheduled) return p.ExecMainStartTimestamp ? "Завершено" : "Еще не запускалась";
  return "Остановлена";
}

export async function readServices(): Promise<{ rows: ServiceRow[] }> {
  const currentCatalog = loadCatalog();
  const serviceKeys = Object.keys(currentCatalog);
  if (serviceKeys.length === 0) {
    return { rows: [] };
  }

  try {
    const { stdout: timersText } = await exec(
      "systemctl",
      ["list-timers", "--all", "--no-pager", "--output=json"],
      { timeout: 8000, maxBuffer: 1024 * 1024 }
    ).catch(() => ({ stdout: "[]" }));

    let timers: { activates: string; unit: string }[] = [];
    try {
      timers = JSON.parse(timersText);
    } catch {
      timers = [];
    }

    const scheduled = new Set(timers.map((t) => t.activates));
    const { stdout } = await exec(
      "systemctl",
      [
        "show",
        ...serviceKeys,
        "-p",
        "Id,LoadState,ActiveState,SubState,Result,ExecMainStartTimestamp,ActiveEnterTimestamp",
      ],
      { timeout: 8000, maxBuffer: 1024 * 1024 }
    );

    const rows: ServiceRow[] = [];
    for (const block of stdout.trim().split(/\n\s*\n/)) {
      if (!block.trim()) continue;
      const p = Object.fromEntries(
        block.split("\n").map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        })
      );
      const entry = currentCatalog[p.Id];
      if (!entry || p.LoadState === "not-found") continue;
      const isScheduled = scheduled.has(p.Id);
      rows.push({
        id: p.Id,
        name: entry[0],
        description: entry[1],
        kind: isScheduled ? "По расписанию" : "Постоянная",
        lastRun: p.ExecMainStartTimestamp || p.ActiveEnterTimestamp || null,
        status: status(p, isScheduled),
      });
    }
    return { rows };
  } catch {
    // If systemctl is not available (macOS, container without systemd), return empty
    return { rows: [] };
  }
}
