import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesPillSelection,
  resolvePillSettings,
  selectComposerPills,
  pillMetrics,
  getDefaultPillMatchRules,
} from "./pills.shared.ts";

test("matchesPillSelection: matches deepseek-harness for deepseek", () => {
  const pill = {
    enabled: true,
    visibility: "matching",
    matchRules: [{ harness: "deepseek-harness" }],
  };
  assert.equal(
    matchesPillSelection(pill, { provider: "deepseek-harness", model: "deepseek-chat" }),
    true,
  );
  assert.equal(
    matchesPillSelection(pill, { provider: "deepseek-harness", model: "deepseek/deepseek-chat" }),
    true,
  );
  assert.equal(
    matchesPillSelection(pill, { provider: "claude", model: "claude-3-5-sonnet" }),
    false,
  );
});

test("matchesPillSelection: inferred provider matches deepseek rules", () => {
  const pill = {
    enabled: true,
    visibility: "matching",
    matchRules: [{ provider: "deepseek" }],
  };
  assert.equal(
    matchesPillSelection(pill, { provider: "deepseek-harness", model: "deepseek-chat" }),
    true,
  );
});

test("resolvePillSettings: deepseek-account is enabled by default as a ring pill", () => {
  const settings = resolvePillSettings(undefined, "deepseek-account");
  assert.ok(settings !== null);
  assert.equal(settings.style, "ring");
  assert.equal(settings.value, "remaining");
  assert.equal(settings.readout, "amount");
});

test("pillMetrics: balance reading without total returns remaining amount readout", () => {
  const reading = {
    id: "wallet",
    label: "Пополненный баланс",
    kind: "balance",
    unit: "usd",
    remaining: 3.425,
    total: null,
    percentRemaining: null,
    currency: "USD",
  };
  const settings = {
    order: null,
    style: "ring",
    value: "remaining",
    reading: null,
    label: "none",
    readout: "amount",
  };
  const metrics = pillMetrics(reading, settings);
  assert.ok(metrics.readout !== null);
  assert.match(metrics.readout, /\$3\.4/);
});

test("selectComposerPills: deepseek provider without explicit pill configuration is selected", () => {
  const providers = [
    {
      providerId: "deepseek-account",
      label: "DeepSeek Harness - аккаунт",
      status: "available",
      display: { order: 3 },
      readings: [],
    },
  ];
  const pills = selectComposerPills(providers);
  assert.equal(pills.length, 1);
  assert.equal(pills[0].providerId, "deepseek-account");
  assert.equal(pills[0].settings.style, "ring");
  assert.equal(
    matchesPillSelection(pills[0].pill, { provider: "deepseek-harness", model: "deepseek-chat" }),
    true,
  );
});

test("getDefaultPillMatchRules: suggested specs include deepseek-harness", () => {
  const rules = getDefaultPillMatchRules("deepseek-account");
  assert.ok(rules.some((r) => r.harness === "deepseek-harness"));
});
