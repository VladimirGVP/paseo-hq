/**
 * A small Markdown subset for the prose around a diagram.
 *
 * Taking over a timeline item means taking over its text too, so this exists to
 * keep that text readable. It covers what agents actually write around a
 * diagram: headings, paragraphs, lists, code and inline emphasis. Anything else
 * survives as plain text rather than as broken markup.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

export type Block =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "bullet"; items: Inline[][] }
  | { kind: "ordered"; items: Inline[][]; start: number }
  | { kind: "code"; language: string; text: string }
  | { kind: "quote"; content: Inline[] }
  | { kind: "rule" };

// A bare URL drops trailing punctuation, so "see https://x.dev." links to https://x.dev.
const INLINE =
  /(`[^`]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]*_]|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;

const WORD_CHAR = /[A-Za-z0-9]/;

/** `_x_` inside a word, as in review_gate_per_project, is not emphasis (CommonMark's rule). */
function intraword(pieces: readonly string[], index: number): boolean {
  const before = pieces[index - 1] ?? "";
  const after = pieces[index + 1] ?? "";
  return WORD_CHAR.test(before.slice(-1)) || WORD_CHAR.test(after.slice(0, 1));
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pieces = text.split(INLINE);
  for (const [index, piece] of pieces.entries()) {
    if (piece.length === 0) continue;
    if (piece.startsWith("_") && piece.endsWith("_") && intraword(pieces, index)) {
      out.push({ kind: "text", text: piece });
      continue;
    }
    const link = LINK.exec(piece);
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1) {
      out.push({ kind: "code", text: piece.slice(1, -1) });
    } else if (link) {
      // Only web and mail links open; any other scheme (javascript:, file:) shows as its text.
      out.push(/^(https?:|mailto:)/i.test(link[2]) ? { kind: "link", text: link[1], url: link[2] } : { kind: "text", text: link[1] });
    } else if (/^https?:\/\//.test(piece)) {
      out.push({ kind: "link", text: piece, url: piece });
    } else if ((piece.startsWith("**") && piece.endsWith("**")) || (piece.startsWith("__") && piece.endsWith("__"))) {
      out.push({ kind: "bold", text: piece.slice(2, -2) });
    } else if ((piece.startsWith("*") && piece.endsWith("*")) || (piece.startsWith("_") && piece.endsWith("_"))) {
      out.push({ kind: "italic", text: piece.slice(1, -1) });
    } else {
      out.push({ kind: "text", text: piece });
    }
  }
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    const text = paragraph.join(" ").trim();
    if (text.length > 0) blocks.push({ kind: "paragraph", content: parseInline(text) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[2], text: body.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, content: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const items: Inline[][] = [parseInline(bullet[1])];
      while (index + 1 < lines.length) {
        const next = BULLET.exec(lines[index + 1]);
        if (!next) break;
        items.push(parseInline(next[1]));
        index += 1;
      }
      blocks.push({ kind: "bullet", items });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flush();
      const items: Inline[][] = [parseInline(ordered[2])];
      while (index + 1 < lines.length) {
        const next = ORDERED.exec(lines[index + 1]);
        if (!next) break;
        items.push(parseInline(next[2]));
        index += 1;
      }
      blocks.push({ kind: "ordered", items, start: Number(ordered[1]) });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: "quote", content: parseInline(quote[1]) });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
