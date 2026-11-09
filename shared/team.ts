import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { boardSchema, teamRepoSchema } from "./team-model.ts";

export * from "./team-model.ts";

export const teamStateRpc = defineRpc({
  name: "team.state",
  input: z.object({}),
  output: z.object({
    connected: z.boolean(),
    repo: teamRepoSchema.nullable(),
    board: boardSchema,
    error: z.string().nullable().default(null),
    syncedAt: z.string().nullable().default(null),
  }),
});

export const teamConnectRpc = defineRpc({
  name: "team.connect",
  input: z.object({
    url: z.string().min(1),
    branch: z.string().default("main"),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable().default(null),
    repo: teamRepoSchema.nullable(),
    board: boardSchema,
  }),
});

export const teamDisconnectRpc = defineRpc({
  name: "team.disconnect",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export const teamSyncRpc = defineRpc({
  name: "team.sync",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    error: z.string().nullable().default(null),
    board: boardSchema,
  }),
});

export const teamSaveRpc = defineRpc({
  name: "team.save",
  input: z.object({
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
