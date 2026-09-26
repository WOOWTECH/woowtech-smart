import pino from "pino";
import { z } from "zod";
import { expect, test } from "vitest";
import { AgentManager } from "./agent/agent-manager.js";
import { generateBranchNameFromFirstAgentContext } from "./worktree-branch-name-generator.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createPersistedWorkspaceRecord, type WorkspaceRegistry } from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("auto-name preserves workspace archival that lands during its metadata write", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name",
    projectId: "project-auto-name",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const mutationStarted = deferred();
  const allowMutation = deferred();
  const updateEmitted = deferred();
  const workspaceRegistry = {
    update: async (_workspaceId, updater) => {
      mutationStarted.resolve();
      await allowMutation.promise;
      workspace = updater(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "update">;
  const autoName = new WorkspaceAutoName({
    isAutoNameEnabled: () => true,
    agentManager: {} as AgentManager,
    workspaceRegistry,
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "generated", branch: null }),
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt: "Name this workspace" },
  });
  await mutationStarted.promise;
  const archivedAt = "2026-08-08T00:01:00.000Z";
  workspace = { ...workspace, updatedAt: archivedAt, archivedAt };
  allowMutation.resolve();
  await updateEmitted.promise;

  expect(workspace).toMatchObject({
    title: "generated",
    archivedAt,
  });
});

function autoNameOffFixture(
  kind: Parameters<typeof createPersistedWorkspaceRecord>[0]["kind"] = "directory",
) {
  const calls = {
    schedule: 0,
    generator: 0,
    providerSnapshots: 0,
    instructions: 0,
    structured: 0,
    daemonConfig: 0,
    registry: 0,
    gitMutations: 0,
    emit: 0,
  };
  const queued: Array<() => void> = [];
  const emitted = deferred();
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name-off",
    projectId: "project-auto-name-off",
    cwd: "/synthetic/workspace-auto-name-off",
    worktreeRoot: kind === "worktree" ? "/synthetic/workspace-auto-name-off" : null,
    kind,
    branch: kind === "worktree" ? "keep-existing-branch" : null,
    title: "Original title",
    displayName: "Original directory",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  });
  const workspaceRegistry = {
    update: async (_workspaceId, update) => {
      calls.registry += 1;
      workspace = update(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "update">;
  const logger = pino({ level: "silent" });
  const options: ConstructorParameters<typeof WorkspaceAutoName>[0] = {
    agentManager: new AgentManager({ logger, clients: {}, providerDefinitions: {} }),
    workspaceRegistry,
    workspaceGitService: {
      resolveRepoRoot: async () => {
        throw new Error("unexpected filesystem lookup");
      },
    },
    providerSnapshotManager: {
      listProviders: async () => {
        calls.providerSnapshots += 1;
        return [];
      },
    },
    readDaemonConfig: () => {
      calls.daemonConfig += 1;
      return { metadataGeneration: { providers: [{ provider: "claude", model: "haiku" }] } };
    },
    gitMutation: {
      notifyGitMutation: async () => {
        calls.gitMutations += 1;
      },
    },
    emitWorkspaceUpdateForCwd: async () => {
      calls.emit += 1;
      emitted.resolve();
    },
    emitWorkspaceUpdateForWorkspaceId: async () => {
      calls.emit += 1;
      emitted.resolve();
    },
    logger,
    scheduleTask: (run) => {
      calls.schedule += 1;
      queued.push(run);
    },
    generateWorkspaceName: async (input) => {
      calls.generator += 1;
      return generateBranchNameFromFirstAgentContext({
        ...input,
        deps: {
          buildMetadataPrompt: async () => {
            calls.instructions += 1;
            return "Synthetic naming prompt";
          },
          generateStructuredAgentResponseWithFallback: async (request) => {
            calls.structured += 1;
            if (!(request.schema instanceof z.ZodType)) throw new Error("expected a Zod schema");
            return request.schema.parse({ title: "Generated title", branch: "generated-branch" });
          },
        },
      });
    },
  };
  return { options, calls, queued, emitted, workspaceRegistry, workspace: () => workspace };
}

test("woowtech OFF baseline skips scheduling and every metadata dependency for directory and worktree", async () => {
  const f = autoNameOffFixture();
  const before = f.workspace();
  const autoName = new WorkspaceAutoName(f.options);
  const firstAgentContext = { prompt: "Private synthetic task: leave workspace naming alone" };
  autoName.scheduleForDirectory({
    workspaceId: before.workspaceId,
    cwd: before.cwd,
    firstAgentContext,
  });
  const worktree = autoNameOffFixture("worktree");
  const originalWorktree = worktree.workspace();
  new WorkspaceAutoName(worktree.options).scheduleForWorktree({
    workspace: originalWorktree,
    firstAgentContext,
  });
  await Promise.resolve();
  const noCalls = {
    schedule: 0,
    generator: 0,
    providerSnapshots: 0,
    instructions: 0,
    structured: 0,
    daemonConfig: 0,
    registry: 0,
    gitMutations: 0,
    emit: 0,
  };
  expect(f.calls).toEqual(noCalls);
  expect(worktree.calls).toEqual(noCalls);
  expect(f.queued).toEqual([]);
  expect(worktree.queued).toEqual([]);
  expect(f.workspace()).toEqual(before);
  expect(worktree.workspace()).toEqual(originalWorktree);
  await f.workspaceRegistry.update(before.workspaceId, (current) => ({
    ...current,
    title: "Manual rename",
  }));
  autoName.scheduleForDirectory({
    workspaceId: before.workspaceId,
    cwd: before.cwd,
    firstAgentContext,
  });
  expect(f.workspace()).toEqual({ ...before, title: "Manual rename" });
  expect(f.queued).toEqual([]);
});

test("the explicit upstream test policy exercises the typed metadata dependencies", async () => {
  const f = autoNameOffFixture();
  const autoName = new WorkspaceAutoName({ ...f.options, isAutoNameEnabled: () => true });
  autoName.scheduleForDirectory({
    workspaceId: f.workspace().workspaceId,
    cwd: f.workspace().cwd,
    firstAgentContext: { prompt: "Synthetic task" },
  });
  expect(f.queued.length).toBe(1);
  f.queued[0]();
  await f.emitted.promise;
  expect(f.calls).toEqual({
    schedule: 1,
    generator: 1,
    providerSnapshots: 1,
    instructions: 1,
    structured: 1,
    daemonConfig: 1,
    registry: 1,
    gitMutations: 0,
    emit: 1,
  });
});
