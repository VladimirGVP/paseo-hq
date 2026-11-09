import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const projectMetaSchema = z.object({
  avatarUri: z.string().nullable().default(null),
  avatarEmoji: z.string().nullable().default(null),
  avatarBg: z.string().nullable().default(null),
  newSessionMode: z.enum(["directory", "worktree"]).default("directory"),
  hidden: z.boolean().default(false),
  sessionTitleModel: z.string().nullable().default(null),
  sessionsSortMode: z.enum(["auto", "manual"]).default("auto"),
  sessionOrder: z.array(z.string()).default([]),
});

const sidebarStateSchema = z.object({
  projects: z.record(z.string(), projectMetaSchema),
  nativeIcons: z.record(z.string(), z.string()),
  lastRunningAt: z.record(z.string(), z.number()),
  pinnedSessions: z.record(z.string(), z.number()),
  showHostMetrics: z.boolean().default(true),
  showZorMetrics: z.boolean().default(true),
  showWorkersMetrics: z.boolean().default(true),
  headerTitle: z.string().default("Штаб"),
  projectsSortMode: z.enum(["auto", "manual"]).default("auto"),
  projectOrder: z.array(z.string()).default([]),
});

const panelSettingsInputSchema = z.object({
  headerTitle: z.string().optional(),
  showHostMetrics: z.boolean().optional(),
  showZorMetrics: z.boolean().optional(),
  showWorkersMetrics: z.boolean().optional(),
  projectsSortMode: z.enum(["auto", "manual"]).optional(),
  projectOrder: z.array(z.string()).optional(),
  projectIds: z.array(z.string()).default([]),
});

const projectSaveInputSchema = z.object({
  projectId: z.string().min(1),
  customName: z.string().nullable().optional(),
  newSessionMode: z.enum(["directory", "worktree"]).optional(),
  hidden: z.boolean().optional(),
  sessionTitleModel: z.string().nullable().optional(),
  sessionsSortMode: z.enum(["auto", "manual"]).optional(),
  sessionOrder: z.array(z.string()).optional(),
});

test("sidebarStateSchema and panelSettingsInput validate projectsSortMode and projectOrder", () => {
  const parsedSettings = panelSettingsInputSchema.parse({
    projectsSortMode: "manual",
    projectOrder: ["proj-1", "proj-2", "proj-3"],
    projectIds: ["proj-1"],
  });
  assert.equal(parsedSettings.projectsSortMode, "manual");
  assert.deepEqual(parsedSettings.projectOrder, ["proj-1", "proj-2", "proj-3"]);

  const parsedState = sidebarStateSchema.parse({
    projects: {},
    nativeIcons: {},
    lastRunningAt: {},
    pinnedSessions: {},
    showHostMetrics: true,
    showZorMetrics: true,
    showWorkersMetrics: true,
    headerTitle: "Штаб",
    projectsSortMode: "manual",
    projectOrder: ["proj-b", "proj-a"],
  });
  assert.equal(parsedState.projectsSortMode, "manual");
  assert.deepEqual(parsedState.projectOrder, ["proj-b", "proj-a"]);
});

test("projectMetaSchema and projectSaveInput validate sessionsSortMode and sessionOrder", () => {
  const parsedSave = projectSaveInputSchema.parse({
    projectId: "proj-1",
    sessionsSortMode: "manual",
    sessionOrder: ["sess-2", "sess-1"],
  });
  assert.equal(parsedSave.sessionsSortMode, "manual");
  assert.deepEqual(parsedSave.sessionOrder, ["sess-2", "sess-1"]);

  const parsedMeta = projectMetaSchema.parse({
    avatarUri: null,
    avatarEmoji: null,
    avatarBg: null,
    newSessionMode: "directory",
    hidden: false,
    sessionTitleModel: null,
    sessionsSortMode: "manual",
    sessionOrder: ["sess-2", "sess-1"],
  });
  assert.equal(parsedMeta.sessionsSortMode, "manual");
  assert.deepEqual(parsedMeta.sessionOrder, ["sess-2", "sess-1"]);
});

test("sorting logic: manual order overrides timestamp, auto order sorts by timestamp", () => {
  const items = [
    { id: "a", lastPromptAt: 100 },
    { id: "b", lastPromptAt: 500 },
    { id: "c", lastPromptAt: 300 },
  ];

  // Auto sort: descending by lastPromptAt
  const autoSorted = [...items].sort((x, y) => y.lastPromptAt - x.lastPromptAt);
  assert.deepEqual(autoSorted.map((i) => i.id), ["b", "c", "a"]);

  // Manual sort by projectOrder: ["a", "c", "b"]
  const manualOrder = ["a", "c", "b"];
  const orderMap = new Map(manualOrder.map((id, idx) => [id, idx]));
  const manualSorted = [...items].sort((x, y) => {
    const xIdx = orderMap.has(x.id) ? orderMap.get(x.id) : 999999;
    const yIdx = orderMap.has(y.id) ? orderMap.get(y.id) : 999999;
    return xIdx - yIdx;
  });
  assert.deepEqual(manualSorted.map((i) => i.id), ["a", "c", "b"]);
});
