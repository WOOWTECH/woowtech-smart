import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import {
  createClaudeAgentSdkSource,
  type ClaudeAgentSdkModule,
} from "./claude-agent-sdk-runtime.js";
import { ClaudeAgentSdkDownloadError } from "./claude-agent-sdk-download.js";
import { claudeQuery, type ClaudeQueryInput } from "./query.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";

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

test.each([false, true])(
  "same in-memory session retries on the next message, without replay (init control=%s)",
  async (fastMode) => {
    await mkdir(path.resolve(".dev/f11-repair/fixtures"), { recursive: true });
    const directory = await mkdtemp(path.resolve(".dev/f11-repair/fixtures/sdk-session-"));
    const delivered: unknown[] = [];
    let loads = 0;
    const sdk = {
      query: (input: ClaudeQueryInput) => fixtureQuery(input, delivered),
    } as ClaudeAgentSdkModule;
    const source = createClaudeAgentSdkSource(async () => {
      if (++loads === 1) throw new ClaudeAgentSdkDownloadError(503);
      return sdk;
    });
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => "/fixture/never-executed",
      resolveVersion: async () => "fixture",
      queryFactory: (request) => claudeQuery(request, { sdk: source }),
    });
    const session = await client.createSession(
      {
        provider: "claude",
        cwd: directory,
        ...(fastMode ? { featureValues: { fast_mode: true } } : {}),
      },
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
      const result = await session.run("fixture-second-only");
      expect(result.finalText).toBe("fixture reply");
      expect(delivered).toEqual([[{ type: "text", text: "fixture-second-only" }]]);
      expect(events.filter((event) => event.type === "turn_completed")).toHaveLength(1);
      expect(loads).toBe(2);
      expect(await source.ensure()).toBe(sdk);
      expect(loads).toBe(2);
    } finally {
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
