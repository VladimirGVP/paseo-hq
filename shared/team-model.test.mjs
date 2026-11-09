import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_BOARD,
  boardDisplayName,
  memberTaskCounts,
  mergeBoard,
  nextTaskStatus,
  parseBoard,
  prevTaskStatus,
  taskColumns,
} from "./team-model.ts";

function task(id, patch = {}) {
  return {
    id,
    title: `Задача ${id}`,
    description: "",
    status: "backlog",
    assigneeId: null,
    projectId: null,
    priority: 0,
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
    externalUrl: null,
    personal: false,
    ownerId: null,
    ...patch,
  };
}

function member(id, patch = {}) {
  return {
    id,
    kind: "human",
    name: `Член ${id}`,
    role: "",
    avatar: "🙂",
    container: null,
    updatedAt: "2026-11-09T10:00:00.000Z",
    ...patch,
  };
}

test("пустая доска читается с умолчаниями", () => {
  const board = parseBoard({});
  assert.equal(board.version, 1);
  assert.deepEqual(board.members, []);
  assert.deepEqual(board.tasks, []);
});

test("название доски берётся из ссылки", () => {
  assert.equal(boardDisplayName("https://github.com/gnatovskie/hq-team.git", ""), "hq-team");
  assert.equal(boardDisplayName("https://github.com/gnatovskie/hq-team.git", "Команда"), "Команда");
});

test("статус задачи идёт по кругу", () => {
  assert.equal(nextTaskStatus("backlog"), "doing");
  assert.equal(nextTaskStatus("doing"), "review");
  assert.equal(nextTaskStatus("review"), "done");
  assert.equal(nextTaskStatus("done"), "backlog");
});

test("статус задачи можно откатить назад", () => {
  assert.equal(prevTaskStatus("done"), "review");
  assert.equal(prevTaskStatus("review"), "doing");
  assert.equal(prevTaskStatus("doing"), "backlog");
  assert.equal(prevTaskStatus("backlog"), "backlog");
});

test("колонки раскладывают задачи по статусу и приоритету", () => {
  const columns = taskColumns({
    ...EMPTY_BOARD,
    tasks: [
      task("a", { status: "backlog", priority: 0 }),
      task("b", { status: "backlog", priority: 2 }),
      task("c", { status: "doing" }),
    ],
  });
  assert.equal(columns.backlog.length, 2);
  assert.equal(columns.backlog[0].id, "b");
  assert.equal(columns.doing.length, 1);
  assert.equal(columns.review.length, 0);
});

test("счётчик задач не считает готовые и без исполнителя", () => {
  const counts = memberTaskCounts({
    ...EMPTY_BOARD,
    tasks: [
      task("a", { assigneeId: "m1", status: "doing" }),
      task("b", { assigneeId: "m1", status: "done" }),
      task("c", { assigneeId: "m2", status: "backlog" }),
      task("d", { status: "backlog" }),
    ],
  });
  assert.deepEqual(counts, { m1: 1, m2: 1 });
});

test("слияние досок не теряет задачи двух людей", () => {
  const remote = { ...EMPTY_BOARD, members: [member("m1")], tasks: [task("a")] };
  const incoming = {
    ...EMPTY_BOARD,
    members: [member("m2", { updatedAt: "2026-11-09T11:00:00.000Z" })],
    tasks: [task("b")],
  };
  const merged = mergeBoard(remote, incoming);
  assert.deepEqual(merged.members.map((m) => m.id).sort(), ["m1", "m2"]);
  assert.deepEqual(merged.tasks.map((t) => t.id).sort(), ["a", "b"]);
});

test("слияние берёт более свежую версию и применяет удаления", () => {
  const remote = {
    ...EMPTY_BOARD,
    members: [member("m1")],
    tasks: [task("a", { title: "старое", updatedAt: "2026-11-09T10:00:00.000Z" }), task("b")],
  };
  const incoming = {
    ...EMPTY_BOARD,
    members: [],
    tasks: [task("a", { title: "новое", updatedAt: "2026-11-09T12:00:00.000Z" })],
  };
  const merged = mergeBoard(remote, incoming, ["b"], ["m1"]);
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].title, "новое");
  assert.equal(merged.members.length, 0);
});
