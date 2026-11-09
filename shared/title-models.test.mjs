import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTitleModels, titleModelOptions, titleModelProviders } from "./title-models.ts";

test("catalog contains every selectable model of enabled providers, preserving nested ids", () => {
  const entries = [
    { provider: "codex", label: "Codex", enabled: true, models: [{ id: "new-model", label: "New model" }, { id: "hidden", label: "Hidden", isSelectable: false }] },
    { provider: "kimi", enabled: true, models: [{ id: "kimi-code/kimi-for-coding", label: "Kimi" }] },
    { provider: "disabled", enabled: false, models: [{ id: "other", label: "Other" }] },
  ];
  assert.deepEqual(titleModelOptions(entries, "first_line").map(m => m.value), ["first_line", "codex/new-model", "kimi/kimi-code/kimi-for-coding"]);
});
test("saved unavailable model remains visible without silently changing selection", () => {
  assert.deepEqual(titleModelOptions([], "old/model").map(m => m.value), ["first_line", "old/model"]);
  assert.match(titleModelOptions([], "old/model")[1].label, /недоступна/);
});
test("duplicate ids from one provider appear once", () => {
  const model = { id: "model", label: "Model" };
  assert.equal(titleModelOptions([{ provider: "codex", enabled: true, models: [model, model] }], "first_line").length, 2);
});
test("picker narrows models by provider and by every query word", () => {
  const options = titleModelOptions([
    { provider: "codex", label: "Codex", enabled: true, models: [{ id: "gpt-6-luna", label: "GPT-6 Luna" }, { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" }] },
    { provider: "claude", label: "Claude", enabled: true, models: [{ id: "claude-haiku-5-5", label: "Haiku 5.5" }] },
  ], "first_line");
  assert.deepEqual(titleModelProviders(options), [{ provider: "claude", label: "Claude", count: 1 }, { provider: "codex", label: "Codex", count: 2 }]);
  assert.deepEqual(filterTitleModels(options, "codex", "").map(m => m.name), ["GPT-6 Luna", "GPT-6.1 Sol"]);
  assert.deepEqual(filterTitleModels(options, null, "gpt sol").map(m => m.value), ["codex/gpt-6.1-sol"]);
  assert.deepEqual(filterTitleModels(options, null, "haiku").map(m => m.value), ["claude/claude-haiku-5-5"]);
});
