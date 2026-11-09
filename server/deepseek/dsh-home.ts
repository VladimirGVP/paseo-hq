import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveDshHome(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return join(homedir(), ".dsh");
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}
