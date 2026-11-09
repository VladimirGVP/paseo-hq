import { describe, expect, it } from "vitest";
import { compile, evaluate, initialState } from "./core";
import { repairRequest } from "./fallback";

const noFiles = async () => ({ ok: false as const, error: "no files in this test" });

const LINK_SPEC = `Card("Mergeable PRs", [
  Text("Four can merge"),
  Link("https://github.com/acme/api/pull/1", "PR 1")
])`;

describe("unknown components", () => {
  it("render as an Error node and keep the rest of the block", () => {
    const { program, diagnostics } = compile(LINK_SPEC);
    expect(program).not.toBeNull();
    expect(diagnostics.map((d) => d.severity)).toEqual(["warning"]);
    const { roots, diagnostics: runtime } = evaluate(program!, initialState(program!));
    const card = roots[0];
    expect(card.type).toBe("Card");
    const children = (card.props.children as { type: string }[]).map((child) => child.type);
    expect(children).toEqual(["Text", "Error"]);
    expect(runtime[0].message).toContain("`Link` is not a component");
  });

  it("stay errors when the name is a function call that needs a value", () => {
    expect(compile(`x = 1\nCard("a", [Text(x())])`).program).toBeNull();
  });
});

describe("repairRequest", () => {
  it("lists each failing ```ui block for the agent", async () => {
    const reply = `Answer.\n\n\`\`\`ui\nCard("ok", [Text("fine")])\n\`\`\`\n\n\`\`\`ui\n${LINK_SPEC}\n\`\`\``;
    const request = await repairRequest(reply, noFiles);
    expect(request).toMatch(/^\[genui\]/);
    expect(request).toContain("Block 2:");
    expect(request).not.toContain("Block 1:");
    expect(request).toContain("`Link` is not a component");
  });

  it("is null when every block renders", async () => {
    expect(await repairRequest('```ui\nCard("ok", [Text("fine")])\n```', noFiles)).toBeNull();
    expect(await repairRequest("No UI here.", noFiles)).toBeNull();
  });
});
