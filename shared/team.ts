import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { boardConfigSchema, boardSchema } from "./team-model.ts";

export * from "./team-model.ts";

export const boardSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  branch: z.string(),
  dir: z.string(),
  name: z.string(),
  syncedAt: z.string().nullable().default(null),
});

export type BoardSummary = z.infer<typeof boardSummarySchema>;

export const boardsListRpc = defineRpc({
  name: "team.boards.list",
  input: z.object({}),
  output: z.object({
    boards: z.array(boardSummarySchema),
    activeBoardId: z.string().nullable().default(null),
  }),
});

export const boardsSelectRpc = defineRpc({
  name: "team.boards.select",
  input: z.object({ boardId: z.string().min(1) }),
  output: z.object({
    ok: z.boolean(),
    activeBoardId: z.string(),
  }),
});

export const boardsConnectRpc = defineRpc({
  name: "team.boards.connect",
  input: z.object({
    url: z.string().min(1),
    branch: z.string().default("main"),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable().default(null),
    board: boardSummarySchema.nullable(),
  }),
});

export const boardsDisconnectRpc = defineRpc({
  name: "team.boards.disconnect",
  input: z.object({ boardId: z.string().min(1) }),
  output: z.object({ ok: z.boolean() }),
});

export const boardStateRpc = defineRpc({
  name: "team.board.state",
  input: z.object({ boardId: z.string().min(1) }),
  output: z.object({
    board: boardSchema,
    error: z.string().nullable().default(null),
    syncedAt: z.string().nullable().default(null),
  }),
});

export const boardSyncRpc = defineRpc({
  name: "team.board.sync",
  input: z.object({ boardId: z.string().min(1) }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable().default(null),
    board: boardSchema,
  }),
});

export const boardSaveRpc = defineRpc({
  name: "team.board.save",
  input: z.object({
    boardId: z.string().min(1),
    board: boardSchema,
    removedTaskIds: z.array(z.string()).default([]),
    removedMemberIds: z.array(z.string()).default([]),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable().default(null),
    board: boardSchema,
  }),
});

export { boardConfigSchema };
