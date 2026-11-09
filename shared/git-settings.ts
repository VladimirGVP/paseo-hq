import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const gitWorkspaceSettings = defineSettings({
  id: "git-workspace",
  scope: "host",
  version: 1,
  schema: z.object({
    gitlabUrl: z
      .string()
      .trim()
      .default("https://gitlab.com"),
    cloneDir: z
      .string()
      .trim()
      .default("~/repos"),
    githubCloneProtocol: z.enum(["ssh", "https"]).default("https"),
    cloneProtocol: z
      .enum(["ssh", "https"])
      .default("ssh"),
    defaultIsolation: z
      .enum(["worktree", "local"])
      .default("worktree"),
  }),
});

export type GitWorkspaceSettings = z.output<typeof gitWorkspaceSettings.schema>;
