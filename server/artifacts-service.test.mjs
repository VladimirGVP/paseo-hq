import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactsService, inferArtifactTitle, sanitizeFileName } from "./artifacts-service.server.ts";

test("ArtifactsService: sanitize and infer title", () => {
  assert.equal(sanitizeFileName("../../evil.html"), "evil.html");
  assert.equal(sanitizeFileName("report 123.svg"), "report_123.svg");

  const html = `<!DOCTYPE html><html><head><title>Мой Дашборд</title></head><body><h1>Тест</h1></body></html>`;
  assert.equal(inferArtifactTitle("index.html", html, "html"), "Мой Дашборд");

  const md = `# Архитектура системы\n\nОписание`;
  assert.equal(inferArtifactTitle("doc.md", md, "markdown"), "Архитектура системы");
});

test("ArtifactsService: lifecycle, save, read, list, and delete", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "artifacts-test-"));
  try {
    const service = new ArtifactsService(tmpDir);
    await service.init();

    // Initial list is empty
    const initial = await service.list();
    assert.deepEqual(initial, []);

    // Save HTML artifact
    const savedHtml = await service.save({
      name: "calc.html",
      kind: "html",
      content: "<!DOCTYPE html><html><title>Калькулятор</title><body><h1>Калькулятор</h1></body></html>",
      projectId: "project-1",
      projectDisplayName: "Проект 1",
      workspaceId: "ws-1",
    });

    assert.equal(savedHtml.name, "calc.html");
    assert.equal(savedHtml.title, "Калькулятор");
    assert.equal(savedHtml.projectId, "project-1");
    assert.equal(savedHtml.projectDisplayName, "Проект 1");
    assert.ok(savedHtml.sha256);

    // Save SVG artifact
    const savedSvg = await service.save({
      name: "diagram.svg",
      kind: "svg",
      content: '<svg viewBox="0 0 100 100"><title>Схема сети</title><circle cx="50" cy="50" r="40"/></svg>',
      projectId: "project-2",
      projectDisplayName: "Проект 2",
    });

    assert.equal(savedSvg.name, "diagram.svg");
    assert.equal(savedSvg.title, "Схема сети");

    // List all
    const all = await service.list();
    assert.equal(all.length, 2);

    // Filter by project
    const p1 = await service.list({ projectId: "project-1" });
    assert.equal(p1.length, 1);
    assert.equal(p1[0].id, savedHtml.id);

    // Read artifact content
    const readRes = await service.read(savedHtml.id);
    assert.ok(readRes);
    assert.equal(readRes.artifact.id, savedHtml.id);
    assert.ok(readRes.content.includes("Калькулятор"));

    // Ensure persistence by creating a second instance pointing to same tmpDir
    const service2 = new ArtifactsService(tmpDir);
    const reloaded = await service2.list();
    assert.equal(reloaded.length, 2);

    // Deduplication check: saving same content returns existing artifact without duplicate
    const duplicateSave = await service.save({
      name: "calc.html",
      kind: "html",
      content: "<!DOCTYPE html><html><title>Калькулятор</title><body><h1>Калькулятор</h1></body></html>",
      projectId: "project-1",
    });
    assert.equal(duplicateSave.id, savedHtml.id);
    const listAfterDup = await service.list();
    assert.equal(listAfterDup.length, 2);

    // Delete
    const deleted = await service.delete(savedHtml.id);
    assert.equal(deleted, true);
    const afterDelete = await service.list();
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].id, savedSvg.id);

    // Tombstone check: attempting to re-save deleted artifact from chat must NOT resurrect it
    const reSaveDeleted = await service.save({
      name: "calc.html",
      kind: "html",
      content: "<!DOCTYPE html><html><title>Калькулятор</title><body><h1>Калькулятор</h1></body></html>",
      sourceType: "chat_code",
    });
    assert.ok(reSaveDeleted.id.startsWith("deleted_"));
    const listAfterResurrect = await service.list();
    assert.equal(listAfterResurrect.length, 1);
    assert.equal(listAfterResurrect[0].id, savedSvg.id);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
