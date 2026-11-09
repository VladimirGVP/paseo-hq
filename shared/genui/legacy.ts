import type { PluginTimelineItem } from "@getpaseo/plugin";
import { genuiBlockDataSchema, genuiTextDataSchema } from "./rpc";
import { GENUI_BLOCK_KIND, GENUI_TEXT_KIND } from "./segment";

/** Re-render persisted render_ui/demo rows owned by the former installation. */
export function adoptLegacyGenuiItem(item: PluginTimelineItem & { pluginId: string }) {
  if (item.pluginId !== "genui" || item.version !== 1) return undefined;
  const schema = item.kind === GENUI_BLOCK_KIND ? genuiBlockDataSchema
    : item.kind === GENUI_TEXT_KIND ? genuiTextDataSchema : null;
  if (!schema) return undefined;
  const parsed = schema.safeParse(item.data);
  if (!parsed.success) return undefined;
  return { items: [{ type: "plugin" as const, id: item.id, kind: item.kind, version: 1, data: parsed.data }] };
}
