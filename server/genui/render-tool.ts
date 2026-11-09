// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { actionsOnly, specProblems } from "../../shared/genui/fallback";
import { GENUI_BLOCK_KIND, GENUI_TEXT_KIND } from "../../shared/genui/segment";
import { loadAgentFile } from "./data-source";

let seq = 0;

/** Shows a ui spec in the agent's chat only when it renders; otherwise returns the errors so the agent fixes them in the same turn. */
export const renderUiTool = defineAgentTool({
  name: "render_ui",
  title: "Show UI",
  description:
    "Optional: show a ui spec to the user as live UI, checked first. A ```ui block in the reply is the usual way; use this when the spec loads files you have not checked. If the spec has errors, nothing is shown and the errors come back. Fix them and call again without mentioning the errors or the retry to the user. Put the answer sentence in `answer`: it is shown as text above the UI, so do not also write it in the reply, and do not repeat the UI's content in text after it.",
  input: z.object({
    answer: z.string().min(1).describe("One plain sentence that gives the answer; shown above the UI"),
    spec: z.string().describe("The ui spec, without the ``` fence"),
  }),
  async execute({ answer, spec }, { agent, paseo }) {
    const checked = await specProblems(spec, (request) => loadAgentFile(paseo, agent.id, request.path, request));
    // Only here: prose before a render_ui call is often lost in the agent's reasoning, while a ```ui block's prose is in the reply.
    const problems =
      checked.roots !== null && actionsOnly(checked.roots)
        ? [...checked.problems, "The card has only buttons. Put what each option does, and the findings behind the choice, in the card itself (Text, Callout, Table, Steps)."]
        : checked.problems;
    if (problems.length > 0) {
      return {
        isError: true,
        text: `Nothing was shown. Fix these and call render_ui again; do not tell the user about them:\n${problems.join("\n")}`,
      };
    }
    const id = `genui-render-${Date.now()}-${++seq}`;
    // The answer travels in the tool input because agents often write it in their reasoning, which the user never sees.
    await paseo.agents.ref(agent.id).timeline.append({
      type: "plugin",
      id: `${id}-answer`,
      kind: GENUI_TEXT_KIND,
      version: 1,
      data: { text: answer, phase: "complete" },
    });
    await paseo.agents.ref(agent.id).timeline.append({
      type: "plugin",
      id,
      kind: GENUI_BLOCK_KIND,
      version: 1,
      data: { language: "ui", code: spec, complete: true, fenceIndex: 0, messageId: id },
    });
    return { text: "Shown to the user. Do not repeat its content or mention earlier failed calls." };
  },
});
