import { type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Options, Query, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

import {
  createProviderEnv,
  createProviderEnvSpec,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { buildSelfNodeCommand } from "../../../paseo-env.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import {
  type ClaudeAgentSdkModule,
  type ClaudeAgentSdkSource,
  ensureClaudeAgentSdk,
  peekClaudeAgentSdk,
} from "./claude-agent-sdk-runtime.js";
import { DeferredQuery } from "./deferred-query.js";

// Keep SDK query access in this module only. Claude process launch behavior
// must stay shared between production and tests so Windows .cmd/.bat handling cannot
// diverge from the daemon path.

export type ClaudeOptions = Options;
export type ClaudeQueryInput = Parameters<ClaudeAgentSdkModule["query"]>[0] & {
  options: ClaudeOptions;
};
export type ClaudeQueryFactory = (input: ClaudeQueryInput) => Query;

export type { ClaudeAgentSdkSource } from "./claude-agent-sdk-runtime.js";

const defaultSdkSource: ClaudeAgentSdkSource = {
  peek: peekClaudeAgentSdk,
  ensure: ensureClaudeAgentSdk,
};

export interface ClaudeQueryContext {
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: Record<string, string>;
  queryFactory?: ClaudeQueryFactory;
  sdk?: ClaudeAgentSdkSource;
  /** Called with the spawned child process so the caller can tree-kill it on close. */
  onChildProcess?: (child: ChildProcess) => void;
}

function isChildProcessWithStreams(child: ChildProcess): child is ChildProcessWithoutNullStreams {
  return child.stdin !== null && child.stdout !== null && child.stderr !== null;
}

function resolveClaudeSpawnCommand(
  spawnOptions: SpawnOptions,
  runtimeSettings?: ProviderRuntimeSettings,
): { command: string; args: string[] } {
  const commandConfig = runtimeSettings?.command;
  if (!commandConfig || commandConfig.mode === "default") {
    return {
      command: spawnOptions.command,
      args: [...spawnOptions.args],
    };
  }

  if (commandConfig.mode === "append") {
    return {
      command: spawnOptions.command,
      args: [...spawnOptions.args, ...(commandConfig.args ?? [])],
    };
  }

  return {
    command: commandConfig.argv[0],
    args: [...commandConfig.argv.slice(1), ...spawnOptions.args],
  };
}

function applyRuntimeSettingsToClaudeOptions(
  options: ClaudeOptions,
  context: ClaudeQueryContext,
): ClaudeOptions {
  const { runtimeSettings, launchEnv, onChildProcess } = context;
  return {
    ...options,
    spawnClaudeCodeProcess: (spawnOptions) => {
      const resolved = resolveClaudeSpawnCommand(spawnOptions, runtimeSettings);
      // When the SDK passes a default JS runtime ("node"/"bun"), replace it with
      // process.execPath — the actual node binary running the daemon. This avoids
      // PATH lookup failures in the managed runtime bundle.
      // When the SDK passes a native binary path (from pathToClaudeCodeExecutable)
      // or the user overrides the command via runtime settings, use that directly.
      const isDefaultRuntime = resolved.command === "node" || resolved.command === "bun";
      const providerEnvSpec = createProviderEnvSpec({
        baseEnv: spawnOptions.env,
        runtimeSettings,
        overlays: [launchEnv],
      });
      const providerEnv = createProviderEnv({
        baseEnv: spawnOptions.env,
        runtimeSettings,
        overlays: [launchEnv],
      });
      // buildSelfNodeCommand starts again from the daemon's own environment, so
      // unset the parent Claude Code session's variables there too.
      const selfNodeCommand = isDefaultRuntime
        ? buildSelfNodeCommand(resolved.args, { ...providerEnv, ...providerEnvSpec.envOverlay })
        : null;
      const command = selfNodeCommand?.command ?? resolved.command;
      const args = selfNodeCommand?.args ?? resolved.args;
      const child = spawnProcess(command, args, {
        cwd: spawnOptions.cwd,
        ...(selfNodeCommand
          ? { env: selfNodeCommand.env, envMode: "internal" as const }
          : providerEnvSpec),
        signal: spawnOptions.signal,
        stdio: ["pipe", "pipe", "pipe"],
        // Bypass cmd.exe on Windows: the SDK passes --mcp-config with inline JSON
        // containing double quotes, which cmd.exe mangles (strips quotes, breaks parsing).
        // The command is always a resolved binary path, so shell routing is unnecessary.
        shell: false,
      });
      onChildProcess?.(child);
      if (typeof options.stderr === "function") {
        child.stderr?.on("data", (chunk: Buffer | string) => {
          options.stderr?.(chunk.toString());
        });
      }
      if (!isChildProcessWithStreams(child)) {
        throw new Error("Claude process was spawned without stdio streams");
      }
      return child;
    },
  };
}

/**
 * A query whose SDK load failed. It only repeats that failure, so a session builds a new one,
 * which loads the SDK again (woowtech/README.md §3).
 */
export function claudeQueryLoadFailed(query: Query): boolean {
  return query instanceof DeferredQuery && query.failed;
}

export function claudeQuery(input: ClaudeQueryInput, context: ClaudeQueryContext = {}): Query {
  const request: ClaudeQueryInput = {
    ...input,
    options: applyRuntimeSettingsToClaudeOptions(input.options, context),
  };
  if (context.queryFactory) {
    return context.queryFactory(request);
  }
  const source = context.sdk ?? defaultSdkSource;
  const sdk = source.peek();
  if (sdk) {
    return sdk.query(request);
  }
  return new DeferredQuery(source.ensure().then((loaded) => () => loaded.query(request)));
}
