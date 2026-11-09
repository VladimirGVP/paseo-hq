import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const artifactKindSchema = z.enum([
  "html",
  "svg",
  "markdown",
  "code",
  "data",
  "file",
]);

export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const storedArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  kind: artifactKindSchema,
  size: z.number(),
  createdAt: z.string(),
  projectDisplayName: z.string().optional(),
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
  agentId: z.string().optional(),
  sourceType: z.enum(["chat_code", "file_created", "manual"]).default("chat_code"),
  yadiskUrl: z.string().optional(),
  sha256: z.string().optional(),
  telegramSent: z.boolean().optional(),
  telegramSentAt: z.string().optional(),
});

export type StoredArtifact = z.infer<typeof storedArtifactSchema>;

export const artifactsListRpc = defineRpc({
  name: "artifacts.list",
  input: z.object({
    projectId: z.string().optional(),
    workspaceId: z.string().optional(),
    kind: artifactKindSchema.optional(),
    limit: z.number().default(100),
  }),
  output: z.object({
    artifacts: z.array(storedArtifactSchema),
  }),
});

export const artifactReadRpc = defineRpc({
  name: "artifacts.read",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    artifact: storedArtifactSchema,
    content: z.string(),
  }),
});

export const artifactSaveRpc = defineRpc({
  name: "artifacts.save",
  input: z.object({
    id: z.string().optional(),
    name: z.string(),
    title: z.string().optional(),
    kind: artifactKindSchema,
    content: z.string(),
    projectId: z.string().optional(),
    projectDisplayName: z.string().optional(),
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    sourceType: z.enum(["chat_code", "file_created", "manual"]).default("chat_code"),
  }),
  output: z.object({
    artifact: storedArtifactSchema,
  }),
});

export const artifactUploadYadiskRpc = defineRpc({
  name: "artifacts.upload-yadisk",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    yadiskUrl: z.string().optional(),
    error: z.string().optional(),
  }),
});

export const artifactSendTelegramRpc = defineRpc({
  name: "artifacts.send-telegram",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const artifactDeleteRpc = defineRpc({
  name: "artifacts.delete",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
});
