import { describe, expect, it } from "vitest";
import { commentText, composeReply, editText, hasOwnNumber } from "./reply";

describe("reply", () => {
  it("joins queued items before the final message and drops blanks", () => {
    expect(composeReply(["Fix all", "  ", "On step 3 (Checks): use nudge"], "Go ahead with the plan.")).toBe(
      "Fix all\n\nOn step 3 (Checks): use nudge\n\nGo ahead with the plan.",
    );
    expect(composeReply([], "Go")).toBe("Go");
    expect(composeReply(["Only queued"], null)).toBe("Only queued");
  });

  it("writes comments and edits, and skips empty ones", () => {
    expect(commentText("step 2 (Spec)", "  split it ")).toBe("On step 2 (Spec): split it");
    expect(commentText("step 2 (Spec)", " ")).toBeNull();
    expect(editText("step 2", { title: "Spec", detail: "One migration" }, { title: "Spec v2", detail: "One migration" })).toBe(
      'Edit step 2: title "Spec" → "Spec v2"',
    );
    expect(editText("step 2", { title: "Spec" }, { title: "Spec " })).toBeNull();
  });

  it("detects titles that carry their own number", () => {
    expect(hasOwnNumber("1. Spec + shared schema")).toBe(true);
    expect(hasOwnNumber("2a. Needs you")).toBe(true);
    expect(hasOwnNumber("3) Release")).toBe(true);
    expect(hasOwnNumber("2026 roadmap")).toBe(false);
    expect(hasOwnNumber("Spec")).toBe(false);
  });
});
