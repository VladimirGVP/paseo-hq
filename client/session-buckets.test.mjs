import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAgentBucket,
  pickWorkspaceBucket,
  resolveChatBucket,
} from "./session-buckets.ts";

test("рабочий чат важнее упавшего, в любом порядке", () => {
  assert.equal(pickWorkspaceBucket(pickWorkspaceBucket(undefined, "failed"), "running"), "running");
  assert.equal(pickWorkspaceBucket(pickWorkspaceBucket(undefined, "running"), "failed"), "running");
});

test("failed остаётся, только если все чаты упали", () => {
  assert.equal(pickWorkspaceBucket(pickWorkspaceBucket(undefined, "failed"), "failed"), "failed");
});

test("failed уступает done, attention и needs_input", () => {
  assert.equal(pickWorkspaceBucket("failed", "done"), "done");
  assert.equal(pickWorkspaceBucket("failed", "attention"), "attention");
  assert.equal(pickWorkspaceBucket("failed", "needs_input"), "needs_input");
});

test("среди рабочих чатов берётся самый важный", () => {
  assert.equal(pickWorkspaceBucket("done", "running"), "running");
  assert.equal(pickWorkspaceBucket("attention", "needs_input"), "needs_input");
  let b;
  for (const status of ["done", "failed", "running"]) b = pickWorkspaceBucket(b, status);
  assert.equal(b, "running");
});

test("статус воркспейса failed не заслоняет рабочий чат", () => {
  assert.equal(resolveChatBucket({ id: "w1", status: "failed" }, { w1: "running" }), "running");
  assert.equal(resolveChatBucket({ id: "w1", status: "failed" }, { w1: "done" }), "done");
});

test("воркспейс остаётся failed, если упали все его чаты", () => {
  assert.equal(resolveChatBucket({ id: "w1", status: "failed" }, { w1: "failed" }), "failed");
});

test("ошибка агента распознаётся как failed", () => {
  assert.equal(deriveAgentBucket({ status: "error" }), "failed");
  assert.equal(deriveAgentBucket({ status: "idle", attentionReason: "error" }), "failed");
  assert.equal(deriveAgentBucket({ status: "running" }), "running");
  assert.equal(deriveAgentBucket({ status: "idle" }), "done");
  assert.equal(deriveAgentBucket({ status: "idle", pendingPermissions: [{}] }), "needs_input");
});
