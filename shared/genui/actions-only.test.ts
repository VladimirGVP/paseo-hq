import { describe, expect, it } from "vitest";
import { compile, evaluate, initialState } from "./core";
import { actionsOnly, specProblems } from "./fallback";

const load = async () => ({ ok: false as const, error: "no files" });

function roots(spec: string) {
  const { program } = compile(spec);
  return evaluate(program!, initialState(program!, new Map()), new Map()).roots;
}

describe("cards with only buttons", () => {
  const decision = `Card("Fix the missing behavior", [
  Button("Do both (recommended)", Send("Do both"), variant: "primary"),
  Button("Only the clearer instructions", Send("Only instructions")),
  Other()
])`;
  const rowOfButtons = `Card("Fix genui instructions?", [Row([Button("Make both edits"), Button("Only one")])])`;

  it("flags the two cards that hid their explanation", () => {
    expect(actionsOnly(roots(decision))).toBe(true);
    expect(actionsOnly(roots(rowOfButtons))).toBe(true);
  });

  it("does not flag buttons beside content", () => {
    expect(actionsOnly(roots(`Card("Which queue?", [Text("pg-boss reuses Postgres."), Button("pg-boss"), Button("BullMQ")])`))).toBe(false);
  });

  it("leaves a ```ui block of buttons alone, since its prose is in the reply", async () => {
    expect((await specProblems(decision, load)).problems).toEqual([]);
  });
});
