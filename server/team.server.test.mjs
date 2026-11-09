import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

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

test("доски: подключение, сохранение, слияние двух клиентов", async () => {
  const root = await mkdtemp(join(tmpdir(), "hq-team-"));
  const bare = join(root, "team.git");
  process.env.PASEO_HQ_TEAM_DIR = root;
  process.env.PASEO_HQ_TEAM_CONFIG = join(root, "team.json");
  await exec("git", ["init", "--bare", "-q", bare]);

  try {
    const { applyBoardChange, connectBoard, disconnectBoard, flushAll, listBoards, saveBoard, syncBoard } =
      await import("../server/team.server.ts");

    const connected = await connectBoard(`file://${bare}`, "main");
    assert.equal(connected.name, "team");

    await applyBoardChange(connected.id, {
      version: 1,
      name: "",
      updatedAt: "",
      members: [member("m1")],
      tasks: [],
    });
    await flushAll();

    // Второй человек работает в своём клоне того же репозитория.
    const cloneB = join(root, "clone-b");
    await exec("git", ["clone", "-q", `file://${bare}`, cloneB]);
    await saveBoard(
      { id: "b2", url: `file://${bare}`, branch: "main", dir: cloneB },
      { version: 1, name: "", updatedAt: "", members: [], tasks: [task("b", { assigneeId: "m1" })] },
    );

    // Первый клиент досылает свою задачу: обе должны остаться.
    await applyBoardChange(connected.id, {
      version: 1,
      name: "",
      updatedAt: "",
      members: [member("m1")],
      tasks: [task("a")],
    });
    await flushAll();

    const boards = await listBoards();
    assert.equal(boards.length, 1);
    assert.equal(boards[0].name, "team");

    const synced = await syncBoard(connected.id);
    assert.deepEqual(synced.tasks.map((t) => t.id).sort(), ["a", "b"]);

    // Проверяем, что файл действительно уехал в удалённый репозиторий.
    const check = join(root, "check");
    await exec("git", ["clone", "-q", "--branch", "main", `file://${bare}`, check]);
    const raw = JSON.parse(await readFile(join(check, "hq.json"), "utf8"));
    assert.equal(raw.members[0].id, "m1");
    assert.equal(raw.tasks.length, 2);

    await disconnectBoard(connected.id);
    assert.deepEqual(await listBoards(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("доски: ensureRepo считает эквивалентными SSH и HTTPS адреса одного репозитория", async () => {
  const root = await mkdtemp(join(tmpdir(), "hq-match-"));
  try {
    const { ensureRepo } = await import("../server/team.server.ts");
    await exec("git", ["init", "-q", root]);
    await exec("git", ["-C", root, "remote", "add", "origin", "git@github.com:gnatovskie/hq-team.git"]);

    // Не должно бросать ошибку о чужом репозитории, когда это тот же репозиторий через HTTPS
    await ensureRepo({
      id: "b_test",
      url: "https://github.com/gnatovskie/hq-team",
      branch: "main",
      dir: root,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("доски: сохранение активной доски в team.json и переключение между репозиториями", async () => {
  const root = await mkdtemp(join(tmpdir(), "hq-active-"));
  const bare1 = join(root, "repo1.git");
  const bare2 = join(root, "repo2.git");
  process.env.PASEO_HQ_TEAM_DIR = root;
  process.env.PASEO_HQ_TEAM_CONFIG = join(root, "team.json");
  await exec("git", ["init", "--bare", "-q", bare1]);
  await exec("git", ["init", "--bare", "-q", bare2]);

  try {
    const { connectBoard, getActiveBoardId, setActiveBoardId, readConfigFile, listBoards } =
      await import("../server/team.server.ts");

    const b1 = await connectBoard(`file://${bare1}`, "main");
    assert.equal(await getActiveBoardId(), b1.id);

    const b2 = await connectBoard(`file://${bare2}`, "main");
    // Новое подключение становится активным
    assert.equal(await getActiveBoardId(), b2.id);

    // Выбираем первую доску как актуальную
    await setActiveBoardId(b1.id);
    assert.equal(await getActiveBoardId(), b1.id);

    // Проверяем сохранение в team.json
    const disk = JSON.parse(await readFile(join(root, "team.json"), "utf8"));
    assert.equal(disk.activeBoardId, b1.id);
    assert.equal(disk.boards.length, 2);

    // Повторное подключение существующего репозитория возвращает его же и активирует
    const reconnected = await connectBoard(`file://${bare2}`, "main");
    assert.equal(reconnected.id, b2.id);
    assert.equal(await getActiveBoardId(), b2.id);
    const boards = await listBoards();
    assert.equal(boards.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


