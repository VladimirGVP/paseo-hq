// What the user's reply says when it collects queued choices, comments and edits.

/** The queued items, then `last`, as one message; blank parts are dropped. */
export function composeReply(queued: readonly string[], last: string | null): string {
  return [...queued, last ?? ""]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

export function commentText(label: string, comment: string): string | null {
  const trimmed = comment.trim();
  return trimmed === "" ? null : `On ${label}: ${trimmed}`;
}

/** `Edit step 2 (Spec): title "A" → "B"; detail "C" → "D"`, or null when nothing changed. */
export function editText(
  label: string,
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string | null {
  const changes = Object.keys(before).flatMap((field) => {
    const was = before[field] ?? "";
    const now = (after[field] ?? was).trim();
    return now === was.trim() ? [] : [`${field} "${was}" → "${now}"`];
  });
  return changes.length === 0 ? null : `Edit ${label}: ${changes.join("; ")}`;
}

/** True when a title already carries its own number, as in "2a. Checks" or "3) Release". */
export function hasOwnNumber(title: string): boolean {
  return /^\s*\d+[a-z]?[.):]\s/i.test(title);
}
