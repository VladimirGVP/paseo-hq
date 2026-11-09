import test from "node:test";
import assert from "node:assert/strict";
import {
  parseArtifactFences,
  segmentArtifactMessage,
  splitArtifactTimelineMessage,
  ARTIFACT_BLOCK_KIND,
  ARTIFACT_TEXT_KIND,
} from "./artifacts-segment.ts";

test("artifacts-segment: detects and parses html fence", () => {
  const text = `Привет! Вот созданная страница:

\`\`\`html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Аналитический отчет</title>
</head>
<body>
  <h1>Отчет по проекту</h1>
</body>
</html>
\`\`\`

Сообщи, если нужны доработки.`;

  const lines = text.split("\n");
  const fences = parseArtifactFences(lines);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].kind, "html");
  assert.equal(fences[0].title, "Аналитический отчет");
  assert.ok(fences[0].closed);

  const segments = segmentArtifactMessage(text, "complete");
  assert.equal(segments.length, 3);
  assert.equal(segments[0].kind, "text");
  assert.ok(segments[0].text.includes("Привет!"));
  assert.equal(segments[1].kind, "artifact");
  assert.equal(segments[2].kind, "text");
  assert.ok(segments[2].text.includes("Сообщи"));

  const split = splitArtifactTimelineMessage(text, "complete", "msg_1");
  assert.ok(split);
  assert.equal(split.items.length, 3);
  assert.equal(split.items[0].kind, ARTIFACT_TEXT_KIND);
  assert.equal(split.items[1].kind, ARTIFACT_BLOCK_KIND);
  assert.equal(split.items[2].kind, ARTIFACT_TEXT_KIND);
});

test("artifacts-segment: ignores non-artifact code fences", () => {
  const text = `Вот команда для терминала:

\`\`\`bash
echo "Hello world"
ls -la
\`\`\`

Используй ее осторожно.`;

  const lines = text.split("\n");
  const fences = parseArtifactFences(lines);
  assert.equal(fences.length, 0);

  const split = splitArtifactTimelineMessage(text, "complete");
  assert.equal(split, undefined);
});

test("artifacts-segment: detects SVG graphics", () => {
  const text = `Схема сети:

\`\`\`svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <title>Топология кластера</title>
  <circle cx="100" cy="100" r="50" fill="blue" />
</svg>
\`\`\``;

  const lines = text.split("\n");
  const fences = parseArtifactFences(lines);
  assert.equal(fences.length, 1);
  assert.equal(fences[0].kind, "svg");
  assert.equal(fences[0].title, "Топология кластера");

  const split = splitArtifactTimelineMessage(text, "complete");
  assert.ok(split);
  assert.equal(split.items.length, 2);
  assert.equal(split.items[1].kind, ARTIFACT_BLOCK_KIND);
});

test("artifacts-segment: works in browser environment without global Buffer", () => {
  const savedBuffer = globalThis.Buffer;
  try {
    // @ts-ignore
    globalThis.Buffer = undefined;
    const text = `\`\`\`html
<!DOCTYPE html>
<html><head><title>Браузерный тест</title></head><body><h1>Привет</h1></body></html>
\`\`\``;
    const split = splitArtifactTimelineMessage(text, "complete", "msg_browser");
    assert.ok(split);
    assert.equal(split.items.length, 1);
    assert.equal(split.items[0].kind, ARTIFACT_BLOCK_KIND);
    assert.ok(split.items[0].data.size > 50);
  } finally {
    globalThis.Buffer = savedBuffer;
  }
});
