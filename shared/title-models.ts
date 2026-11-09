import type { PaseoProviderSnapshotResult } from "@getpaseo/client";

export const GENERATOR_TITLE = "Штаб: генератор названия";

export interface TitleModelOption {
  label: string;
  value: string;
  /** Provider key, "" for the first-line option and unavailable saved models. */
  provider: string;
  providerLabel: string;
  /** Model name without the provider prefix, for narrow screens. */
  name: string;
}

export function titleModelOptions(entries: PaseoProviderSnapshotResult["entries"], selected: string): TitleModelOption[] {
  const models = entries.filter(entry => entry.enabled !== false).flatMap(entry =>
    (entry.models ?? []).filter(model => model.isSelectable !== false).map(model => ({
      label: `${entry.label ?? entry.provider} - ${model.label}`,
      value: `${entry.provider}/${model.id}`,
      provider: entry.provider,
      providerLabel: entry.label ?? entry.provider,
      name: model.label,
    })),
  );
  const unique = [...new Map(models.map(model => [model.value, model])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
  if (selected !== "first_line" && !unique.some(model => model.value === selected)) {
    unique.unshift({ label: `${selected} (недоступна)`, value: selected, provider: "", providerLabel: "", name: `${selected} (недоступна)` });
  }
  const firstLine = "По первой строке промпта (без ИИ)";
  return [{ label: firstLine, value: "first_line", provider: "", providerLabel: "", name: firstLine }, ...unique];
}

export function titleModelProviders(options: readonly TitleModelOption[]) {
  const providers = new Map<string, { provider: string; label: string; count: number }>();
  for (const option of options) {
    if (!option.provider) continue;
    const current = providers.get(option.provider) ?? { provider: option.provider, label: option.providerLabel, count: 0 };
    current.count += 1;
    providers.set(option.provider, current);
  }
  return [...providers.values()];
}

/** Models of one provider (all when null) whose name or id contains every query word. */
export function filterTitleModels(options: readonly TitleModelOption[], provider: string | null, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter(option => option.provider
    && (!provider || option.provider === provider)
    && words.every(word => `${option.label} ${option.value}`.toLowerCase().includes(word)));
}
