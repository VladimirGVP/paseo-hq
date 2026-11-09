import type { PluginTimelineItem } from "@getpaseo/plugin";
import { findFences } from "./fallback";

export const GENUI_BLOCK_KIND = "genui-block";
export const GENUI_TEXT_KIND = "genui-text";

export type MessageSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "fence";
      readonly language: "ui" | "app";
      readonly code: string;
      readonly complete: boolean;
      readonly fenceIndex: number;
    };

export function segmentMessage(text: string, phase: "streaming" | "complete"): MessageSegment[] {
  const lines = text.split("\n");
  const allFences = findFences(lines);
  const uiFences = allFences.filter((fence) => fence.language === "ui" || fence.language === "app");
  if (uiFences.length === 0) return [{ kind: "text", text }];

  const segments: MessageSegment[] = [];
  let cursor = 0;
  let fenceIndex = 0;
  for (const fence of uiFences) {
    if (fence.open > cursor) {
      const prose = lines.slice(cursor, fence.open).join("\n").trim();
      if (prose !== "") segments.push({ kind: "text", text: prose });
    }
    const language = fence.language === "app" ? "app" : "ui";
    segments.push({
      kind: "fence",
      language,
      code: fence.body,
      complete: fence.closed,
      fenceIndex: fenceIndex++,
    });
    cursor = fence.close + 1;
  }
  if (cursor < lines.length) {
    const tail = lines.slice(cursor).join("\n").trim();
    if (tail !== "") segments.push({ kind: "text", text: tail });
  }
  return segments;
}

export function splitTimelineMessage(
  text: string,
  phase: "streaming" | "complete",
  messageId?: string,
): { items: PluginTimelineItem[] } | undefined {
  const segments = segmentMessage(text, phase);
  if (!segments.some((segment) => segment.kind === "fence")) return undefined;

  const items: PluginTimelineItem[] = [];
  segments.forEach((segment) => {
    if (segment.kind === "fence") {
      items.push({
        type: "plugin",
        kind: GENUI_BLOCK_KIND,
        version: 1,
        data: {
          language: segment.language,
          code: segment.code,
          complete: segment.complete,
          fenceIndex: segment.fenceIndex,
          ...(messageId ? { messageId } : {}),
        },
      });
    } else {
      items.push({
        type: "plugin",
        kind: GENUI_TEXT_KIND,
        version: 1,
        data: { text: segment.text, phase },
      });
    }
  });
  return { items };
}
