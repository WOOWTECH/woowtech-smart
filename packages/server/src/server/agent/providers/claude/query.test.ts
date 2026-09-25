import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import * as spawnUtils from "../../../../utils/spawn.js";
import type { ClaudeAgentSdkModule } from "./claude-agent-sdk-runtime.js";
import { type ClaudeAgentSdkSource, claudeQuery } from "./query.js";

function fakeQuery(messages: SDKMessage[]): Query {
  const generator = (async function* () {
    yield* messages;
  })();
  return Object.assign(generator, {
    setModel: vi.fn(async () => {}),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(),
  }) as unknown as Query;
}

/** An SDK whose loading the test finishes (or fails) explicitly. */
function sdkLoadedLater() {
  let finish!: (sdk: ClaudeAgentSdkModule) => void;
  let fail!: (error: Error) => void;
  const loaded = new Promise<ClaudeAgentSdkModule>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const source: ClaudeAgentSdkSource = { peek: () => null, ensure: () => loaded };
  return { source, finish, fail };
}

const message = (id: string) => ({ type: "assistant", uuid: id }) as unknown as SDKMessage;

async function collect(query: Query): Promise<SDKMessage[]> {
  const received: SDKMessage[] = [];
  for await (const item of query) {
    received.push(item);
  }
  return received;
}

describe("claudeQuery", () => {
  test("streams the conversation once the SDK finishes loading", async () => {
    const { source, finish } = sdkLoadedLater();
    const sdk = { query: vi.fn(() => fakeQuery([message("a"), message("b")])) };

    const query = claudeQuery({ prompt: "hi", options: {} }, { sdk: source });
    const received = collect(query);
    finish(sdk as unknown as ClaudeAgentSdkModule);

    expect(await received).toEqual([message("a"), message("b")]);
  });

  test("forwards control calls made before the SDK finished loading", async () => {
    const { source, finish } = sdkLoadedLater();
    const real = fakeQuery([]);

    const query = claudeQuery({ prompt: "hi", options: {} }, { sdk: source });
    const switched = query.setModel("claude-sonnet-5");
    finish({ query: () => real } as unknown as ClaudeAgentSdkModule);
    await switched;

    expect(real.setModel).toHaveBeenCalledWith("claude-sonnet-5");
  });

  test("reports a failed SDK download through the conversation", async () => {
    const { source, fail } = sdkLoadedLater();

    const query = claudeQuery({ prompt: "hi", options: {} }, { sdk: source });
    const received = collect(query);
    fail(new Error("Claude Agent SDK download failed: HTTP 503"));

    await expect(received).rejects.toThrow("Claude Agent SDK download failed: HTTP 503");
  });

  test("never starts Claude when the session closes before the SDK finished loading", async () => {
    const { source, finish } = sdkLoadedLater();
    const sdk = { query: vi.fn(() => fakeQuery([])) };

    const query = claudeQuery({ prompt: "hi", options: {} }, { sdk: source });
    query.close();
    finish(sdk as unknown as ClaudeAgentSdkModule);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sdk.query).not.toHaveBeenCalled();
  });
});

describe("Claude launch environment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("a Claude started through node does not get the daemon's parent Claude Code session", () => {
    // The node path rebuilds the environment from the daemon's own, which still holds
    // the session the daemon was started from.
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_MESSAGING_TOKEN", "parent-inbox-token");
    vi.stubEnv("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "64000");
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
    const spawn = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    let options: Options | undefined;
    claudeQuery(
      { prompt: "hi", options: {} },
      {
        queryFactory: (request) => {
          options = request.options;
          return fakeQuery([]);
        },
      },
    );

    options?.spawnClaudeCodeProcess?.({
      command: "node",
      args: ["claude.js"],
      cwd: process.cwd(),
      env: {},
      signal: new AbortController().signal,
    });

    const env = spawn.mock.calls[0]?.[2]?.env ?? {};
    expect(["CLAUDECODE", "CLAUDE_CODE_MESSAGING_TOKEN"].filter((name) => name in env)).toEqual([]);
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("64000");
  });
});
