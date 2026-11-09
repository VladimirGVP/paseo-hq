import type { ZorActivity, ZorStats } from "../shared/contracts";
import { DEFAULT_WORKERS, readWorkerActivity, readWorkerStats } from "./workers";

export async function readZorStats(): Promise<ZorStats> {
  const zorConfig = DEFAULT_WORKERS.find((w) => w.id === "zor") || DEFAULT_WORKERS[0]!;
  return readWorkerStats(zorConfig);
}

export async function readZorActivity(): Promise<ZorActivity> {
  const zorConfig = DEFAULT_WORKERS.find((w) => w.id === "zor") || DEFAULT_WORKERS[0]!;
  return readWorkerActivity(zorConfig);
}
