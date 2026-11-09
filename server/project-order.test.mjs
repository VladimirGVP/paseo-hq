import { test } from "node:test";
import assert from "node:assert/strict";
import { projectMetaSchema } from "../shared/project-meta.ts";
import { compareProjectOrder } from "../shared/project-order.ts";

test("pinned projects stay above newer projects, and each group follows activity", () => {
  const projects = [
    { name: "Recent", lastPromptAt: 500, meta: {} },
    { name: "Pinned old", lastPromptAt: 10, meta: { pinned: true } },
    { name: "Pinned new", lastPromptAt: 50, meta: { pinned: true } },
    { name: "Old", lastPromptAt: 1, meta: { pinned: false } },
  ];
  assert.deepEqual(projects.sort(compareProjectOrder).map((project) => project.name), [
    "Pinned new", "Pinned old", "Recent", "Old",
  ]);
  projects.find((project) => project.name === "Pinned old").meta.pinned = false;
  assert.deepEqual(projects.sort(compareProjectOrder).map((project) => project.name), [
    "Pinned new", "Recent", "Pinned old", "Old",
  ]);
});

test("existing project settings default to unpinned and saved pin survives reload", () => {
  const oldSettings = projectMetaSchema.parse({ hidden: false });
  assert.equal(oldSettings.pinned, false);
  const stored = JSON.stringify({ ...oldSettings, pinned: true });
  const reloaded = projectMetaSchema.parse(JSON.parse(stored));
  assert.equal(reloaded.pinned, true);
  assert.equal(reloaded.hidden, false);
});
