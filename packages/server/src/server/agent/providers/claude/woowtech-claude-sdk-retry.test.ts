import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { AgentManager } from "../../agent-manager.js";
import { AgentStorage } from "../../agent-storage.js";
import type { AgentSessionConfig, AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import {
  createClaudeAgentSdkSource,
  type ClaudeAgentSdkModule,
} from "./claude-agent-sdk-runtime.js";
import { ClaudeAgentSdkDownloadError } from "./claude-agent-sdk-download.js";
import { claudeQuery, type ClaudeQueryInput } from "./query.js";

// woowtech smart: after a failed SDK download, the next message in the same conversation loads the
// SDK again (woowtech/README.md §3). The SDK source here fails its first load and then succeeds; no
// test downloads anything or starts Claude.

function fixtureQuery(input: ClaudeQueryInput, delivered: unknown[]): Query {
  const iterator = (async function* (): AsyncGenerator<SDKMessage, void, unknown> {
    if (typeof input.prompt === "string") throw new Error("Expected in-memory message input");
    for await (const prompt of input.prompt as AsyncIterable<SDKUserMessage>) {
      delivered.push(prompt.message.content);
      yield {
        type: "system",
        subtype: "init",
        session_id: "fixture-session",
        permissionMode: "default",
        model: "fixture",
      } as SDKMessage;
      yield { type: "assistant", message: { content: "fixture reply" } } as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
        total_cost_usd: 0,
      } as SDKMessage;
    }
  })();
  const controls = {
    close: () => {
      void iterator.return();
    },
    interrupt: async () => {},
    applyFlagSettings: async () => {},
  } satisfies Pick<Query, "close" | "interrupt" | "applyFlagSettings">;
  return Object.assign(iterator, controls) as Query;
}

/** An SDK source whose first load fails like an unreachable registry, then recovers. */
function recoveringSdkSource(delivered: unknown[]) {
  let loads = 0;
  const sdk = {
    query: (input: ClaudeQueryInput) => fixtureQuery(input, delivered),
  } as ClaudeAgentSdkModule;
  const source = createClaudeAgentSdkSource(async () => {
    if (++loads === 1) throw new ClaudeAgentSdkDownloadError(503);
    return sdk;
  });
  return { sdk, source, loads: () => loads };
}

function fixtureClient(source: ReturnType<typeof recoveringSdkSource>["source"]) {
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/fixture/never-executed",
    resolveVersion: async () => "fixture",
    queryFactory: (request) => claudeQuery(request, { sdk: source }),
  });
}

async function fixtureDirectory(): Promise<string> {
  await mkdir(path.resolve(".dev/f11-repair/fixtures"), { recursive: true });
  return mkdtemp(path.resolve(".dev/f11-repair/fixtures/sdk-session-"));
}

// Opus 5.5 is the default model. Models with fast mode make every new query await
// applyFlagSettings before the turn starts, so the failed load surfaces there, not in the stream.
test.each<{ label: string; config: Pick<AgentSessionConfig, "model" | "featureValues"> }>([
  { label: "no model", config: {} },
  { label: "Sonnet 5, no fast mode", config: { model: "claude-sonnet-5" } },
  { label: "Opus 5.5 (the default), fast mode off", config: { model: "claude-opus-5-5" } },
  {
    label: "Opus 5.5, fast mode on",
    config: { model: "claude-opus-5-5", featureValues: { fast_mode: true } },
  },
])(
  "same in-memory session retries on the next message, without replay ($label)",
  async ({ config }) => {
    const directory = await fixtureDirectory();
    const delivered: unknown[] = [];
    const { sdk, source, loads } = recoveringSdkSource(delivered);
    const session = await fixtureClient(source).createSession(
      { provider: "claude", cwd: directory, ...config },
      { env: { CLAUDE_CONFIG_DIR: directory } },
    );
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await expect(session.run("fixture-first-not-replayed")).rejects.toThrow(
        "[woowtech:claude-sdk:download]",
      );
      expect(events.filter((event) => event.type === "turn_failed")).toHaveLength(1);
      expect(delivered).toEqual([]);
      expect(loads()).toBe(1);
      const result = await session.run("fixture-second-only");
      expect(result.finalText).toBe("fixture reply");
      expect(delivered).toEqual([[{ type: "text", text: "fixture-second-only" }]]);
      expect(events.filter((event) => event.type === "turn_completed")).toHaveLength(1);
      expect(loads()).toBe(2);
      expect(await source.ensure()).toBe(sdk);
      expect(loads()).toBe(2);
    } finally {
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// The app asks for the slash commands, or changes the mode, before the first message is sent.
test.each(["listCommands", "setMode"] as const)(
  "a failed load first met by %s does not make the next message reuse it",
  async (control) => {
    const directory = await fixtureDirectory();
    const delivered: unknown[] = [];
    const { source, loads } = recoveringSdkSource(delivered);
    const session = await fixtureClient(source).createSession(
      { provider: "claude", cwd: directory, model: "claude-sonnet-5" },
      { env: { CLAUDE_CONFIG_DIR: directory } },
    );
    try {
      const call =
        control === "listCommands" ? session.listCommands?.() : session.setMode("default");
      await expect(call).rejects.toThrow("[woowtech:claude-sdk:download]");
      expect(loads()).toBe(1);
      const result = await session.run("fixture-after-control");
      expect(result.finalText).toBe("fixture reply");
      expect(delivered).toEqual([[{ type: "text", text: "fixture-after-control" }]]);
      expect(loads()).toBe(2);
    } finally {
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// The daemon's own path, as the desktop app and the CLI reach it: the default model, and the
// failed turn written into the timeline, where the app shows it (woowtech/README.md §3).
test("the agent manager's next message downloads again, and the failed turn is the loader's message", async () => {
  const directory = await fixtureDirectory();
  const delivered: unknown[] = [];
  const { source, loads } = recoveringSdkSource(delivered);
  class FixtureClaudeClient extends ClaudeAgentClient {
    // Never look for a claude binary on this machine.
    override async isAvailable(): Promise<boolean> {
      return true;
    }
  }
  const logger = createTestLogger();
  const manager = new AgentManager({
    clients: {
      claude: new FixtureClaudeClient({
        logger,
        resolveBinary: async () => "/fixture/never-executed",
        resolveVersion: async () => "fixture",
        queryFactory: (request) => claudeQuery(request, { sdk: source }),
      }),
    },
    registry: new AgentStorage(path.join(directory, "agents"), logger),
    logger,
  });
  const agent = await manager.createAgent(
    { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
    undefined,
    { workspaceId: undefined, env: { CLAUDE_CONFIG_DIR: directory } },
  );
  try {
    await expect(manager.runAgent(agent.id, "fixture-first")).rejects.toThrow(
      "[woowtech:claude-sdk:download]",
    );
    const failedTurns = manager
      .getTimeline(agent.id)
      .flatMap((item) =>
        item.type === "assistant_message" && item.text.startsWith("[System Error]")
          ? [item.text]
          : [],
      );
    // The app's zh-TW notice matches this exact row (packages/app/src/utils/claude-sdk-error.ts).
    expect(failedTurns).toEqual([`[System Error] ${new ClaudeAgentSdkDownloadError(503).message}`]);
    expect(loads()).toBe(1);

    const result = await manager.runAgent(agent.id, "fixture-second");
    expect(result.finalText).toBe("fixture reply");
    expect(delivered).toEqual([[{ type: "text", text: "fixture-second" }]]);
    expect(loads()).toBe(2);
  } finally {
    await manager.closeAgent(agent.id);
    await rm(directory, { recursive: true, force: true });
  }
});
