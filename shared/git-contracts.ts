import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const AuthStatusSchema = z.object({
  installed: z.boolean(),
  loggedIn: z.boolean(),
  user: z.string().optional(),
  host: z.string().optional(),
  error: z.string().optional(),
});

export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const CheckAuthRpc = defineRpc({
  name: "git.check-auth",
  input: z.object({
    gitlabUrl: z.string().optional(),
    forceRefresh: z.boolean().optional(),
  }),
  output: z.object({
    github: AuthStatusSchema,
    gitlab: AuthStatusSchema,
  }),
});

export const RepoItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string(),
  url: z.string(),
  sshUrl: z.string(),
  httpUrl: z.string(),
  defaultBranch: z.string(),
  provider: z.enum(["github", "gitlab"]),
  isPrivate: z.boolean(),
  isLocal: z.boolean(),
  localPath: z.string(),
  updatedAt: z.string().optional(),
});

export type RepoItem = z.infer<typeof RepoItemSchema>;

export const ListReposRpc = defineRpc({
  name: "git.list-repos",
  input: z.object({
    provider: z.enum(["all", "github", "gitlab"]).default("all"),
    query: z.string().optional(),
    gitlabUrl: z.string().optional(),
    cloneDir: z.string().optional(),
    forceRefresh: z.boolean().optional(),
  }),
  output: z.object({
    repos: z.array(RepoItemSchema),
    lastSyncedAt: z.number().optional(),
    isSyncing: z.boolean().optional(),
    auth: z
      .object({
        github: AuthStatusSchema,
        gitlab: AuthStatusSchema,
      })
      .optional(),
    errors: z.array(z.string()).optional(),
  }),
});

export const TriggerSyncRpc = defineRpc({
  name: "git.trigger-sync",
  input: z.object({
    gitlabUrl: z.string().optional(),
    cloneDir: z.string().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    lastSyncedAt: z.number(),
    count: z.number(),
    auth: z.object({
      github: AuthStatusSchema,
      gitlab: AuthStatusSchema,
    }),
  }),
});

export const CreateWorkspaceRpc = defineRpc({
  name: "git.create-workspace",
  input: z.object({
    provider: z.enum(["github", "gitlab"]),
    repoFullName: z.string(),
    cloneUrl: z.string(),
    branch: z.string().optional(),
    isolation: z.enum(["worktree", "local"]).default("worktree"),
    gitlabUrl: z.string().optional(),
    cloneDir: z.string().optional(),
  }),
  output: z.object({
    workspaceId: z.string(),
    title: z.string(),
    localPath: z.string(),
  }),
});
