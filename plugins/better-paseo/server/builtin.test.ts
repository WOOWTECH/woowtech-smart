import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ZodType } from "zod";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import contribute from "./builtin.js";
import { tasksChunkRpc, tasksDismissErrorRpc, tasksErrorDismissalsRpc } from "../shared/tasks-rpc";
import { updateCheckRpc } from "../shared/update-check";
import { openTerminalRpc } from "../shared/open-terminal";

// Runs the generated production server entry with an in-process SDK adapter.
// Actual schemas, task RPCs, chunk code and filesystem persistence run here.
function runtime() {
  const settings = new Map<string, ZodType>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const context = {
    registerSettings(definition: { id: string; schema: ZodType }) {
      settings.set(definition.id, definition.schema);
      return {
        read: async () => ({
          status: "ready",
          revision: "missing",
          values: definition.schema.parse({}),
        }),
      };
    },
    handle(contract: PluginRpcContract, handler: (input: unknown) => unknown) {
      if (handlers.has(contract.name)) throw new Error(`Duplicate RPC: ${contract.name}`);
      handlers.set(contract.name, handler);
    },
    addHook: () => () => {},
  } as unknown as PluginServerContext;
  const stop = contribute(context);
  return {
    settings,
    stop,
    async call(contract: PluginRpcContract, input: unknown) {
      const handler = handlers.get(contract.name);
      if (!handler) throw new Error(`Missing RPC: ${contract.name}`);
      return contract.output.parseAsync(await handler(contract.input.parse(input)));
    },
  };
}

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "better-paseo-builtin-"));
  vi.stubEnv("PASEO_HOME", home);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

test("the production bundle registers board-on, chat-off defaults and accepts explicit choices", () => {
  const plugin = runtime();
  try {
    const board = plugin.settings.get("tasks")!;
    const presentation = plugin.settings.get("presentation")!;
    expect(board.parse({})).toMatchObject({ enabled: true });
    expect(board.parse({ enabled: false })).toMatchObject({ enabled: false });
    expect(presentation.parse({})).toMatchObject({ chatEnabled: false, autoUpdateCheck: false });
    expect(presentation.parse({ chatEnabled: true, language: "zh-TW" })).toMatchObject({
      chatEnabled: true,
      language: "zh-TW",
    });
  } finally {
    plugin.stop();
  }
});

test("the packaged board/settings chunk preserves callable exports and matches its content ID", async () => {
  const plugin = runtime();
  try {
    const build = JSON.parse(
      await readFile(new URL("../builtin-build.json", import.meta.url), "utf8"),
    ) as { tasksChunkId: string };
    const result = (await plugin.call(tasksChunkRpc, { id: build.tasksChunkId })) as {
      code: string | null;
    };
    expect(typeof result.code).toBe("string");
    expect(createHash("sha256").update(result.code!).digest("hex").slice(0, 16)).toBe(
      build.tasksChunkId,
    );
    // The real production post-pass copies exports before module initialization.
    // Stop at its first dependency import: all four UI entry points must already
    // be functions, not undefined snapshots of exported wrapper constants.
    const chunk = { exports: {} as Record<string, unknown> };
    const stopBeforeImports = new Error("Stop before host imports");
    const factory = new Function("require", "module", "exports", result.code!);
    expect(() =>
      factory(
        () => {
          throw stopBeforeImports;
        },
        chunk,
        chunk.exports,
      ),
    ).toThrow(stopBeforeImports);
    expect(chunk.exports).toMatchObject({
      TasksBoardScreen: expect.any(Function),
      TasksSidebarEntry: expect.any(Function),
      TasksSettingsPanel: expect.any(Function),
      BetterPaseoSettingsPage: expect.any(Function),
    });
    expect(await plugin.call(tasksChunkRpc, { id: "unknown-chunk" })).toEqual({ code: null });
  } finally {
    plugin.stop();
  }
});

test("a board error dismissal survives reloading the builtin using the host's isolated data directory", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const first = runtime();
  try {
    expect(
      await first.call(tasksDismissErrorRpc, { agentId: "agent-a", error: "Provider unavailable" }),
    ).toEqual({
      agentId: "agent-a",
      error: "Provider unavailable",
      dismissedAt: 1_800_000_000_000,
    });
  } finally {
    first.stop();
  }
  const reloaded = runtime();
  try {
    expect(await reloaded.call(tasksErrorDismissalsRpc, {})).toEqual({
      entries: [
        {
          agentId: "agent-a",
          error: "Provider unavailable",
          dismissedAt: 1_800_000_000_000,
        },
      ],
    });
  } finally {
    reloaded.stop();
  }
});

test("builtin self-update requests stay product-managed and never call the network", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network request"));
  const plugin = runtime();
  try {
    expect(await plugin.call(updateCheckRpc, { action: "check" })).toEqual({ state: "local" });
    expect(
      await plugin.call(openTerminalRpc, {
        source: "git",
        latest: "e9ac5216185988ce99574b3e2f04f178020204f1",
      }),
    ).toEqual({ status: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    plugin.stop();
  }
});
