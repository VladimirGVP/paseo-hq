import { describe, expect, it } from "vitest";
import { splitHqTimelineMessage } from "./hq-timeline";
import { adoptLegacyGenuiItem } from "../shared/genui/legacy";
import { listGallery, readGallerySpec, sketchFontDataUrl } from "../server/genui/data-source";

const fence = (language: string, body: string) => `\`\`\`${language}\n${body}\n\`\`\``;

describe("HQ owns inline UI and document rendering", () => {
  it("renders UI, sandbox app and documents in one reply without dropping prose", () => {
    const text = [
      "Before", fence("ui", 'Card("Count", [Metric("Items", 3)])'),
      "Between", fence('markdown filename="plan.md"', "# Plan\nKeep this document"),
      fence("app", "<html><body>Sandbox</body></html>"), "After",
    ].join("\n\n");
    const result = splitHqTimelineMessage(text, "complete", "reply-1");
    expect(result?.items.map((item) => item.kind)).toEqual([
      "genui-text", "genui-block", "hq-artifact-text", "hq-artifact-card", "genui-block", "genui-text",
    ]);
    expect(result?.items[1]?.data).toMatchObject({ language: "ui", messageId: "reply-1", complete: true });
    expect(result?.items[3]?.data).toMatchObject({ name: "plan.md", code: "# Plan\nKeep this document" });
    expect(result?.items[4]?.data).toMatchObject({ language: "app", fenceIndex: 1 });
    expect(result?.items.at(-1)?.data).toMatchObject({ text: "After" });
  });

  it("keeps streaming UI identity when the closing fence arrives", () => {
    const source = 'Before\n```ui\nCard("Live", [Metric("N", 5)])';
    const streaming = splitHqTimelineMessage(source, "streaming", "live");
    const complete = splitHqTimelineMessage(source + "\n```", "complete", "live");
    expect(streaming?.items[1]?.data).toMatchObject({ messageId: "live", fenceIndex: 0, complete: false });
    expect(complete?.items[1]?.data).toMatchObject({ messageId: "live", fenceIndex: 0, complete: true });
  });

  it("leaves normal code to Paseo and preserves document-only replies", () => {
    expect(splitHqTimelineMessage(fence("ts", "const x = 1"), "complete")).toBeUndefined();
    const result = splitHqTimelineMessage(fence('markdown filename="notes.md"', "# Notes"), "complete");
    expect(result?.items[0]?.kind).toBe("hq-artifact-card");
  });

  it("loads HQ's own gallery and font without the standalone plugin", async () => {
    expect(await listGallery()).toContain("Card.ui");
    expect(await readGallerySpec("Card")).toContain("Card(");
    expect(await sketchFontDataUrl()).toMatch(/^data:font\/woff2;base64,/);
    await expect(readGallerySpec("../package.json")).rejects.toThrow("not a gallery spec");
  });
});

it("adopts saved demo/render_ui rows without changing the stored transcript", () => {
  const old = { type: "plugin" as const, pluginId: "genui", id: "saved", kind: "genui-text", version: 1, data: { text: "Saved answer", phase: "complete" } };
  expect(adoptLegacyGenuiItem(old)?.items[0]).toEqual({ type: "plugin", id: "saved", kind: "genui-text", version: 1, data: old.data });
  expect(old.pluginId).toBe("genui");
  expect(adoptLegacyGenuiItem({ ...old, pluginId: "another" })).toBeUndefined();
  expect(adoptLegacyGenuiItem({ ...old, data: null })).toBeUndefined();
});
