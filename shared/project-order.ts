export function compareProjectOrder(
  a: { name: string; lastPromptAt: number; meta: { pinned?: boolean } },
  b: { name: string; lastPromptAt: number; meta: { pinned?: boolean } },
): number {
  return Number(Boolean(b.meta.pinned)) - Number(Boolean(a.meta.pinned)) || b.lastPromptAt - a.lastPromptAt || a.name.localeCompare(b.name, "ru");
}
