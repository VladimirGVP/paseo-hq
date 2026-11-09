import type { PluginTimelineItem } from "@getpaseo/plugin";

export type ArtifactKind = "html" | "svg" | "markdown" | "code" | "data" | "file";

export function sanitizeFileName(name: string): string {
  const parts = name.split(/[/\\]/);
  const base = (parts[parts.length - 1] ?? "artifact.txt").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "artifact.txt";
}

export function utf8ByteLength(str: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str).length;
  }
  return str.length;
}

export function inferArtifactTitle(name: string, content: string, kind: ArtifactKind): string {
  if (kind === "html") {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    if (titleMatch?.[1]?.trim()) {
      return titleMatch[1].trim();
    }
    const h1Match = /<h1[^>]*>([^<]+)<\/h1>/i.exec(content);
    if (h1Match?.[1]?.trim()) {
      return h1Match[1].trim();
    }
  } else if (kind === "markdown") {
    const h1Match = /^#\s+(.+)$/m.exec(content);
    if (h1Match?.[1]?.trim()) {
      return h1Match[1].trim();
    }
  } else if (kind === "svg") {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    if (titleMatch?.[1]?.trim()) {
      return titleMatch[1].trim();
    }
  }
  return sanitizeFileName(name);
}


export const ARTIFACT_BLOCK_KIND = "hq-artifact-card";
export const ARTIFACT_TEXT_KIND = "hq-artifact-text";

export interface ArtifactFence {
  language: string;
  kind: ArtifactKind;
  name: string;
  title: string;
  body: string;
  openLine: number;
  closeLine: number;
  closed: boolean;
  fenceIndex: number;
}

export type ArtifactMessageSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "artifact";
      readonly fence: ArtifactFence;
    };

function detectKind(lang: string, body: string): ArtifactKind | null {
  const l = lang.toLowerCase().trim();
  const trimmedBody = body.trim();

  // 1. Явно помеченные артефакты: ```artifact, ```artifact:html, ```markdown filename="plan.md"
  if (l.startsWith("artifact:") || l === "artifact" || /filename=["']?[^"'\s>]+["']?/i.test(l)) {
    if (l.includes("html") || l.includes("htm")) return "html";
    if (l.includes("svg")) return "svg";
    if (l.includes("md") || l.includes("markdown")) return "markdown";
    if (l.includes("json") || l.includes("csv")) return "data";
    const fnMatch = /filename=["']?([^"'\s>]+)["']?/i.exec(l);
    if (fnMatch?.[1]) {
      const ext = fnMatch[1].split(".").pop()?.toLowerCase();
      if (ext === "html" || ext === "htm") return "html";
      if (ext === "svg") return "svg";
      if (ext === "md" || ext === "markdown") return "markdown";
      if (ext === "json" || ext === "csv") return "data";
      return "file";
    }
    return "markdown";
  }

  // 2. Внутренний комментарий-маркер: <!-- filename: report.html --> или <!-- artifact -->
  const hasArtifactComment = /<!--\s*(filename|artifact):?\s*([^\s>]*)\s*-->/i.test(trimmedBody);
  if (hasArtifactComment) {
    if (l === "html" || l === "htm") return "html";
    if (l === "svg") return "svg";
    if (l === "markdown" || l === "md") return "markdown";
  }

  // 3. Полноценный самостоятельный HTML-документ (DOCTYPE или html+head/body, не короткий сниппет)
  if (l === "html" || l === "htm" || !l) {
    const isFullHtml =
      trimmedBody.includes("<!DOCTYPE html>") ||
      (trimmedBody.includes("<html") &&
        trimmedBody.includes("</html>") &&
        (trimmedBody.includes("<body") || trimmedBody.includes("<head")));
    if (isFullHtml && trimmedBody.length >= 80) {
      return "html";
    }
  }

  // 4. Полноценный самостоятельный SVG-документ (не мелкий тег в разметке)
  if (l === "svg" || (!l && trimmedBody.startsWith("<svg"))) {
    const isFullSvg =
      trimmedBody.includes("<svg") &&
      trimmedBody.includes("</svg>") &&
      (trimmedBody.includes("viewBox=") || trimmedBody.includes("xmlns="));
    if (isFullSvg && trimmedBody.length >= 60) {
      return "svg";
    }
  }

  // Обычный ```markdown без имени файла или простой HTML-сниппет (<button>, <div>) остается обычным блоком кода!
  return null;
}

function deriveName(lang: string, body: string, kind: ArtifactKind, index: number): string {
  // Проверка на имя файла в строке запуска: ```html filename="report.html"
  const filenameMatch = /filename=["']?([^"'\s>]+)["']?/i.exec(lang);
  if (filenameMatch?.[1]) {
    return sanitizeFileName(filenameMatch[1]);
  }

  // Проверка на комментарий имени: <!-- filename: report.html -->
  const commentMatch = /<!--\s*filename:\s*([^\s>]+)\s*-->/i.exec(body);
  if (commentMatch?.[1]) {
    return sanitizeFileName(commentMatch[1]);
  }

  const ext = kind === "html" ? "html" : kind === "svg" ? "svg" : kind === "markdown" ? "md" : "txt";
  return `artifact-${index + 1}.${ext}`;
}

export function parseArtifactFences(lines: string[]): ArtifactFence[] {
  const fences: ArtifactFence[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let openLine = -1;
  let rawLang = "";
  let bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);

    if (!inFence) {
      if (match && match[2]) {
        inFence = true;
        fenceChar = match[2][0] ?? "`";
        fenceLen = match[2].length;
        openLine = i;
        rawLang = (match[3] ?? "").trim();
        bodyLines = [];
      }
    } else {
      if (match && match[2] && match[2][0] === fenceChar && match[2].length >= fenceLen) {
        // Конец блока
        const body = bodyLines.join("\n");
        const kind = detectKind(rawLang, body);
        if (kind) {
          const name = deriveName(rawLang, body, kind, fences.length);
          const title = inferArtifactTitle(name, body, kind);
          fences.push({
            language: rawLang,
            kind,
            name,
            title,
            body,
            openLine,
            closeLine: i,
            closed: true,
            fenceIndex: fences.length,
          });
        }
        inFence = false;
        openLine = -1;
        rawLang = "";
        bodyLines = [];
      } else {
        bodyLines.push(line);
      }
    }
  }

  // Если блок не закрыт (стриминг), но это HTML/SVG достаточного объема
  if (inFence && bodyLines.length > 5) {
    const body = bodyLines.join("\n");
    const kind = detectKind(rawLang, body);
    if (kind) {
      const name = deriveName(rawLang, body, kind, fences.length);
      const title = inferArtifactTitle(name, body, kind);
      fences.push({
        language: rawLang,
        kind,
        name,
        title,
        body,
        openLine,
        closeLine: lines.length - 1,
        closed: false,
        fenceIndex: fences.length,
      });
    }
  }

  return fences;
}

export function segmentArtifactMessage(
  text: string,
  phase: "streaming" | "complete",
): ArtifactMessageSegment[] {
  const lines = text.split("\n");
  const fences = parseArtifactFences(lines);
  if (fences.length === 0) {
    return [{ kind: "text", text }];
  }

  const segments: ArtifactMessageSegment[] = [];
  let cursor = 0;

  for (const fence of fences) {
    if (fence.openLine > cursor) {
      const prose = lines.slice(cursor, fence.openLine).join("\n").trim();
      if (prose !== "") {
        segments.push({ kind: "text", text: prose });
      }
    }
    segments.push({
      kind: "artifact",
      fence,
    });
    cursor = fence.closeLine + 1;
  }

  if (cursor < lines.length) {
    const tail = lines.slice(cursor).join("\n").trim();
    if (tail !== "") {
      segments.push({ kind: "text", text: tail });
    }
  }

  return segments;
}

export function splitArtifactTimelineMessage(
  text: string,
  phase: "streaming" | "complete",
  messageId?: string,
): { items: PluginTimelineItem[] } | undefined {
  const segments = segmentArtifactMessage(text, phase);
  if (!segments.some((s) => s.kind === "artifact")) {
    return undefined;
  }

  const items: PluginTimelineItem[] = [];
  for (const segment of segments) {
    if (segment.kind === "artifact") {
      const f = segment.fence;
      items.push({
        type: "plugin",
        kind: ARTIFACT_BLOCK_KIND,
        version: 1,
        data: {
          name: f.name,
          title: f.title,
          kind: f.kind,
          code: f.body,
          complete: f.closed,
          fenceIndex: f.fenceIndex,
          size: utf8ByteLength(f.body),
          ...(messageId ? { messageId } : {}),
        },
      });
    } else {
      items.push({
        type: "plugin",
        kind: ARTIFACT_TEXT_KIND,
        version: 1,
        data: {
          text: segment.text,
          phase,
        },
      });
    }
  }

  return { items };
}
