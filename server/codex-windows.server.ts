/** WHAM may return the weekly window first when there is no session window. */
export function normalizeCodexWindows(document: unknown): unknown {
  if (!document || typeof document !== "object" || Array.isArray(document)) return document;
  const root = document as Record<string, unknown>;
  const rate = root.rate_limit as Record<string, unknown> | null;
  if (!rate || typeof rate !== "object") return document;
  const primary = rate.primary_window as Record<string, unknown> | null;
  const secondary = rate.secondary_window as Record<string, unknown> | null;
  // Only reorder known windows. Leave unrecognised vendor formats intact.
  if (
    primary?.limit_window_seconds !== 604800 ||
    (secondary != null && secondary.limit_window_seconds !== 18000)
  )
    return document;
  return {
    ...root,
    rate_limit: { ...rate, primary_window: secondary ?? null, secondary_window: primary },
  };
}
