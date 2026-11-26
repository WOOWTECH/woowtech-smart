import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawnProcess as spawnCli, execCommand as execCli } from "@getpaseo/plugin/server";
import { createExternalCommandProcessEnv, type ProcessEnvRecord } from "../server/paseo-env.js";
import { execFile, spawn } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";
import { isWindowsCommandScript } from "./windows-command.js";
import { planDirectWindowsSpawn, type DirectWindowsSpawn } from "./woowtech-windows-spawn.js";
const execFileAsync = promisify(execFile);

interface ExternalEnvOptions {
  baseEnv?: ProcessEnvRecord;
  envMode?: "external" | "internal";
  env?: ProcessEnvRecord;
  envOverlay?: ProcessEnvRecord;
}

export type SpawnProcessOptions = Omit<SpawnOptions, "env"> & ExternalEnvOptions;

interface ExecCommandOptions extends ExternalEnvOptions {
  cwd?: string;
  encoding?: BufferEncoding;
  killSignal?: NodeJS.Signals;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean | string;
  signal?: AbortSignal;
}

interface ExecCommandResult {
  stdout: string;
  stderr: string;
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export function shouldUseWindowsShell(
  command: string,
  args: string[],
  requestedShell?: boolean | string,
): boolean | string {
  if (isWindowsCommandScript(command)) {
    return true;
  }
  if (requestedShell !== undefined) {
    return requestedShell;
  }
  // cmd.exe parses its command line one line at a time, so an argument that
  // contains CR/LF (a GraphQL document, a PR body) is truncated at the first
  // newline even when quoted. Spawn the executable directly instead: Node's
  // argv quoting round-trips newlines without a shell.
  if (args.some((arg) => arg.includes("\n") || arg.includes("\r"))) {
    return false;
  }
  return process.platform === "win32" && !hasPathSeparator(command) && !extname(command);
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const { baseEnv, env, envOverlay, ...spawnOptions } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );
  // woowtech smart: Windows starts programs without cmd.exe when it can (README §31, plan G17).
  const windowsPlan = planDirectWindowsSpawn({
    platform: process.platform,
    command,
    args,
    requestedShell: spawnOptions.shell,
    env: childEnv,
  });
  if (windowsPlan) {
    return spawn(windowsPlan.command, windowsPlan.args, {
      ...spawnOptions,
      env: childEnv,
      shell: false,
      windowsVerbatimArguments: windowsPlan.windowsVerbatimArguments,
      signal: options?.signal,
      windowsHide: true,
    });
  }

  return spawnCli(command, args, {
    ...spawnOptions,
    shell: shouldUseWindowsShell(command, args, spawnOptions.shell),
    env: childEnv,
    signal: options?.signal,
  });
}

export async function execCommand(
  command: string,
  args: string[],
  options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
  const { baseEnv, env, envOverlay } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );
  // woowtech smart: Windows starts programs without cmd.exe when it can (README §31, plan G17).
  const windowsPlan = planDirectWindowsSpawn({
    platform: process.platform,
    command,
    args,
    requestedShell: options?.shell,
    env: childEnv,
  });
  if (windowsPlan) {
    return execWindowsPlan({ plan: windowsPlan, env: childEnv, options });
  }

  return execCli(command, args, {
    cwd: options?.cwd,
    env: childEnv,
    shell: shouldUseWindowsShell(command, args, options?.shell),
    encoding: options?.encoding ?? "utf8",
    signal: options?.signal,
    killSignal: options?.killSignal,
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer,
  }) as Promise<ExecCommandResult>;
}

interface WindowsPlanExec {
  plan: DirectWindowsSpawn;
  env: NodeJS.ProcessEnv;
  options?: ExecCommandOptions;
}

// woowtech smart: execCommand for a planned Windows start (plan G17).
function execWindowsPlan(input: WindowsPlanExec): Promise<ExecCommandResult> {
  const { plan, env, options } = input;
  return execFileAsync(plan.command, plan.args, {
    cwd: options?.cwd,
    env,
    encoding: options?.encoding ?? "utf8",
    killSignal: options?.killSignal,
    signal: options?.signal,
    timeout: options?.timeout,
    maxBuffer: options?.maxBuffer,
    shell: false,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
    windowsHide: true,
  }) as Promise<ExecCommandResult>;
}
