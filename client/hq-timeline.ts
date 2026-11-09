import { genuiTextDataSchema } from "../shared/genui/rpc";
import { splitTimelineMessage, GENUI_TEXT_KIND } from "../shared/genui/segment";
import { splitArtifactTimelineMessage, ARTIFACT_BLOCK_KIND } from "./artifacts-segment";

/** One owner per assistant message, including replies mixing UI and documents. */
export function splitHqTimelineMessage(
  text: string,
  phase: "streaming" | "complete",
  messageId?: string,
) {
  const ui = splitTimelineMessage(text, phase, messageId);
  if (!ui) return splitArtifactTimelineMessage(text, phase, messageId);

  let artifactIndex = 0;
  return {
    items: ui.items.flatMap((item) => {
      if (item.kind !== GENUI_TEXT_KIND) return [item];
      const documents = splitArtifactTimelineMessage(genuiTextDataSchema.parse(item.data).text, phase, messageId);
      if (!documents) return [item];
      return documents.items.map((document) => {
        if (document.kind !== ARTIFACT_BLOCK_KIND) return document;
        const data = document.data;
        if (data === null || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Artifact splitter returned invalid card data");
        }
        return { ...document, data: { ...data, fenceIndex: artifactIndex++ } };
      });
    }),
  };
}
