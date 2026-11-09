import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKERS,
  computeWorkerStatus,
  readAllWorkers,
  readWorkerStats,
  readWorkerActivity,
} from "./workers.ts";

test("workers: defaults have generic workers defined", () => {
  assert.equal(DEFAULT_WORKERS.length, 2);
  const alex = DEFAULT_WORKERS.find((w) => w.id === "alex");
  assert.ok(alex);
  assert.equal(alex.name, "Алексей");
  assert.equal(alex.container, "alex-work");

  const sergey = DEFAULT_WORKERS.find((w) => w.id === "sergey");
  assert.ok(sergey);
  assert.equal(sergey.name, "Сергей");
  assert.equal(sergey.container, "sergey-work");
});

test("workers: computeWorkerStatus logic", () => {
  // Offline when container unavailable
  assert.equal(
    computeWorkerStatus(
      { available: false, cpu: null, cpuLimit: null, memory: null, memoryLimit: null, processes: null },
      { available: false, lastSsh: null, lastMessage: null, agentLast: null, agentMs: null, coverageComplete: false }
    ),
    "offline"
  );

  // Idle when container online but no active agent and low CPU
  assert.equal(
    computeWorkerStatus(
      { available: true, cpu: 1.2, cpuLimit: 4, memory: 500000000, memoryLimit: 2000000000, processes: 10 },
      { available: true, lastSsh: 1000, lastMessage: 1000, agentLast: Date.now() - 500000, agentMs: 50000, coverageComplete: true }
    ),
    "idle"
  );

  // Active when agent ran recently
  assert.equal(
    computeWorkerStatus(
      { available: true, cpu: 0.5, cpuLimit: 4, memory: 500000000, memoryLimit: 2000000000, processes: 10 },
      { available: true, lastSsh: 1000, lastMessage: 1000, agentLast: Date.now() - 30000, agentMs: 50000, coverageComplete: true }
    ),
    "active"
  );

  // Active when CPU load is high
  assert.equal(
    computeWorkerStatus(
      { available: true, cpu: 15.0, cpuLimit: 4, memory: 500000000, memoryLimit: 2000000000, processes: 10 },
      { available: true, lastSsh: 1000, lastMessage: 1000, agentLast: Date.now() - 500000, agentMs: 50000, coverageComplete: true }
    ),
    "active"
  );
});

test("workers: readAllWorkers handles offline workers gracefully", async () => {
  const workers = await readAllWorkers(DEFAULT_WORKERS);
  assert.equal(workers.length, 2);

  const alex = workers.find((w) => w.id === "alex");
  assert.ok(alex);
  assert.equal(alex.name, "Алексей");
  assert.equal(alex.status, "offline");

  const sergey = workers.find((w) => w.id === "sergey");
  assert.ok(sergey);
  assert.equal(sergey.name, "Сергей");
  assert.equal(sergey.status, "offline");
});
