import { z } from "zod";

/** Виды членов команды. Контейнер - только для метрик монитора, человек - просто участник доски. */
export const MEMBER_KINDS = ["human", "container"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export const MEMBER_KIND_LABELS: Record<MemberKind, string> = {
  human: "Человек",
  container: "Контейнер",
};

export const memberSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(MEMBER_KINDS).default("human"),
  name: z.string().min(1),
  role: z.string().default(""),
  avatar: z.string().default("🙂"),
  /** Только для kind container: название контейнера из монитора. */
  container: z.string().nullable().default(null),
  updatedAt: z.string().default(""),
});

export type TeamMember = z.infer<typeof memberSchema>;

export const TASK_STATUSES = ["backlog", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Бэклог",
  doing: "В работе",
  review: "Проверка",
  done: "Готово",
};

export const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(TASK_STATUSES).default("backlog"),
  assigneeId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  priority: z.number().int().min(0).max(5).default(0),
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
  externalUrl: z.string().nullable().default(null),
  /** Личная задача: не делится с остальной командой. */
  personal: z.boolean().default(false),
  /** Кто создал личную задачу (id члена команды), когда это имеет значение. */
  ownerId: z.string().nullable().default(null),
});

export type TeamTask = z.infer<typeof taskSchema>;

export const boardSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().default(""),
  updatedAt: z.string().default(""),
  members: z.array(memberSchema).default([]),
  tasks: z.array(taskSchema).default([]),
});

export type TeamBoard = z.infer<typeof boardSchema>;

export const EMPTY_BOARD: TeamBoard = { version: 1, name: "", updatedAt: "", members: [], tasks: [] };

/** Одна доска = один git-репозиторий с hq.json. */
export const boardConfigSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  branch: z.string().min(1),
  dir: z.string().min(1),
});

export type BoardConfig = z.infer<typeof boardConfigSchema>;

export function boardDisplayName(url: string, boardName: string): string {
  if (boardName && boardName.trim()) return boardName.trim();
  const seg = url.replace(/\.git$/, "").replace(/\/+$/, "").split("/").pop() || "";
  return seg || "Команда";
}

export function parseBoard(raw: unknown): TeamBoard {
  const parsed = boardSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_BOARD };
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function nextTaskStatus(status: TaskStatus): TaskStatus {
  const index = TASK_STATUSES.indexOf(status);
  return TASK_STATUSES[(index + 1) % TASK_STATUSES.length];
}

export function taskColumns(board: TeamBoard): Record<TaskStatus, TeamTask[]> {
  const columns: Record<TaskStatus, TeamTask[]> = { backlog: [], doing: [], review: [], done: [] };
  for (const task of board.tasks) {
    columns[task.status].push(task);
  }
  for (const status of TASK_STATUSES) {
    columns[status].sort(
      (a, b) => b.priority - a.priority || (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
  }
  return columns;
}

export function memberTaskCounts(board: TeamBoard): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of board.tasks) {
    if (task.status === "done" || !task.assigneeId) continue;
    counts[task.assigneeId] = (counts[task.assigneeId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Слияние доски с удалённой копией: разные люди могут создавать задачи независимо,
 * поэтому объединяем по id и берём более свежую запись. Удаления приходят списком id.
 */
export function mergeBoard(
  remote: TeamBoard,
  incoming: TeamBoard,
  removedTaskIds: readonly string[] = [],
  removedMemberIds: readonly string[] = [],
): TeamBoard {
  const members = new Map(remote.members.map((m) => [m.id, m]));
  for (const member of incoming.members) {
    const prev = members.get(member.id);
    if (!prev || (member.updatedAt || "") >= (prev.updatedAt || "")) members.set(member.id, member);
  }
  for (const id of removedMemberIds) members.delete(id);

  const tasks = new Map(remote.tasks.map((t) => [t.id, t]));
  for (const task of incoming.tasks) {
    const prev = tasks.get(task.id);
    if (!prev || (task.updatedAt || "") >= (prev.updatedAt || "")) tasks.set(task.id, task);
  }
  for (const id of removedTaskIds) tasks.delete(id);

  return {
    version: 1,
    name: incoming.name || remote.name,
    updatedAt: new Date().toISOString(),
    members: [...members.values()],
    tasks: [...tasks.values()],
  };
}
