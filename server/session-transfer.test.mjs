import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const sessionTransferInputSchema = z.object({
  workspaceId: z.string().min(1),
  targetProjectId: z.string().min(1),
  archiveOriginal: z.boolean().default(true),
  includeHistory: z.boolean().default(true),
});

const sessionTransferOutputSchema = z.object({
  newWorkspaceId: z.string(),
  targetProjectId: z.string(),
});

test("sessionTransferRpc contract validates correct input and output", () => {
  const input = {
    workspaceId: "wks_1234567890abcdef",
    targetProjectId: "prj_abcdef1234567890",
    archiveOriginal: true,
    includeHistory: true,
  };
  const parsedInput = sessionTransferInputSchema.parse(input);
  assert.equal(parsedInput.workspaceId, input.workspaceId);
  assert.equal(parsedInput.targetProjectId, input.targetProjectId);
  assert.equal(parsedInput.archiveOriginal, true);
  assert.equal(parsedInput.includeHistory, true);

  const defaultInput = sessionTransferInputSchema.parse({
    workspaceId: "wks_1234567890abcdef",
    targetProjectId: "prj_abcdef1234567890",
  });
  assert.equal(defaultInput.archiveOriginal, true);
  assert.equal(defaultInput.includeHistory, true);

  const noArchiveInput = sessionTransferInputSchema.parse({
    workspaceId: "wks_1234567890abcdef",
    targetProjectId: "prj_abcdef1234567890",
    archiveOriginal: false,
  });
  assert.equal(noArchiveInput.archiveOriginal, false);

  const output = {
    newWorkspaceId: "wks_new1234567890ab",
    targetProjectId: "prj_abcdef1234567890",
  };
  const parsedOutput = sessionTransferOutputSchema.parse(output);
  assert.equal(parsedOutput.newWorkspaceId, output.newWorkspaceId);
});

test("transfer simulation creates workspace in target project root and handles archive toggle", async () => {
  let createdPayload = null;
  let archivedWorkspaceId = null;

  const mockPaseo = {
    projects: {
      list: async () => ({
        projects: [
          { projectId: "prj_source", projectRootPath: "/tmp/repos/source-repo", projectDisplayName: "Source" },
          { projectId: "prj_target", projectRootPath: "/tmp/repos/target-repo", projectDisplayName: "Target" },
        ],
      }),
    },
    workspaces: {
      list: async () => ({
        entries: [
          { id: "wks_source", title: "Моя сессия", projectDisplayName: "Source", projectId: "prj_source" },
        ],
      }),
      create: async (opts) => {
        createdPayload = opts;
        return { id: "wks_target_new" };
      },
      archive: async (wsId) => {
        archivedWorkspaceId = wsId;
      },
    },
    agents: {
      list: async () => ({
        entries: [
          {
            agent: {
              id: "ag_1",
              workspaceId: "wks_source",
              provider: "claude",
              model: "claude-haiku-5-5",
              createdAt: "2026-11-08T10:00:00Z",
              updatedAt: "2026-11-08T10:05:00Z",
            },
          },
        ],
      }),
    },
  };

  const forkAttachment = {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_history",
    title: "Chat history",
    text: "Previous conversation context",
  };

  // Simulating handler logic with archiveOriginal: false
  const runTransfer = async ({ archiveOriginal, includeHistory }) => {
    createdPayload = null;
    archivedWorkspaceId = null;

    const projectsRes = await mockPaseo.projects.list();
    const targetProject = projectsRes.projects.find((p) => p.projectId === "prj_target");
    const workspacesRes = await mockPaseo.workspaces.list();
    const sourceWs = workspacesRes.entries.find((w) => w.id === "wks_source");
    const agentsRes = await mockPaseo.agents.list({});
    const sourceAgent = agentsRes.entries[0].agent;

    const targetPath = targetProject.projectRootPath;
    const providerStr = sourceAgent.model ? `${sourceAgent.provider}/${sourceAgent.model}` : sourceAgent.provider;

    const createdWs = await mockPaseo.workspaces.create({
      title: sourceWs.title,
      source: {
        kind: "directory",
        path: targetPath,
        projectId: "prj_target",
      },
      agent: {
        config: { provider: providerStr },
        cwd: targetPath,
        attachments: includeHistory ? [forkAttachment] : undefined,
      },
    });

    if (archiveOriginal) {
      await mockPaseo.workspaces.archive("wks_source");
    }

    return { newWorkspaceId: createdWs.id };
  };

  // Run with archiveOriginal = true
  const res1 = await runTransfer({ archiveOriginal: true, includeHistory: true });
  assert.equal(res1.newWorkspaceId, "wks_target_new");
  assert.equal(createdPayload.source.path, "/tmp/repos/target-repo");
  assert.equal(createdPayload.source.projectId, "prj_target");
  assert.equal(createdPayload.title, "Моя сессия");
  assert.equal(createdPayload.agent.config.provider, "claude/claude-haiku-5-5");
  assert.equal(createdPayload.agent.attachments[0].contextKind, "chat_history");
  assert.equal(archivedWorkspaceId, "wks_source");

  // Run with archiveOriginal = false (unchecked)
  const res2 = await runTransfer({ archiveOriginal: false, includeHistory: true });
  assert.equal(res2.newWorkspaceId, "wks_target_new");
  assert.equal(archivedWorkspaceId, null); // Did NOT archive
});
