import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as ClaudeAgentSdk from "@anthropic-ai/claude-agent-sdk";

import { execCommand } from "../../../../utils/spawn.js";
import { resolvePaseoHome } from "../../../paseo-home.js";
import {
  ClaudeAgentSdkRuntimeError,
  loadManagedClaudeSdk,
} from "./claude-agent-sdk-installation.js";
import {
  claudeAgentSdkRegistry,
  fetchFromRegistry,
  ClaudeAgentSdkDownloadError,
} from "./claude-agent-sdk-download.js";

export { ClaudeAgentSdkDownloadError } from "./claude-agent-sdk-download.js";

export type ClaudeAgentSdkModule = typeof ClaudeAgentSdk;

/** The SDK version the Claude provider is written against (see options.ts). */
export const CLAUDE_AGENT_SDK_VERSION = "0.3.246";

/**
 * Registry integrity of that version's tarball. Downloaded code is executed, so
 * anything that does not match byte for byte is refused. Update together with
 * CLAUDE_AGENT_SDK_VERSION: `npm view @anthropic-ai/claude-agent-sdk@<v> dist.integrity`.
 */
export const CLAUDE_AGENT_SDK_INTEGRITY =
  "sha512-FtR0HoHHNqeqJWjZN8qLUAzZVFUI9ztXYNPPwv98Ecmv9qq2QTauI8IzkY26CC0mleWAqb9RQEW2C0OtiUliug==";

export class ClaudeAgentSdkIntegrityError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      "[woowtech:claude-sdk:integrity] Claude Agent SDK download failed its integrity check; refusing to install it. Send your next message to retry.",
    );
    this.name = "ClaudeAgentSdkIntegrityError";
  }
}

export interface LoadClaudeAgentSdkOptions {
  /** Directory that holds downloaded copies of the SDK. */
  runtimeDir: string;
  /** Loads the SDK from normal module resolution (present in development). */
  importLocal: () => Promise<ClaudeAgentSdkModule>;
  /** Fetches the SDK tarball from the npm registry. */
  fetchTarball: (url: string) => Promise<Uint8Array>;
  version?: string;
  /** Registry base URL, including an optional repository subpath. */
  registry?: string;
  /** Subresource-integrity string of the tarball, e.g. `sha512-…`. */
  integrity?: string;
}

export interface ClaudeAgentSdkSource {
  peek(): ClaudeAgentSdkModule | null;
  ensure(): Promise<ClaudeAgentSdkModule>;
}

/** One owner per daemon; a rejected attempt is never cached. */
export function createClaudeAgentSdkSource(
  load: () => Promise<ClaudeAgentSdkModule>,
): ClaudeAgentSdkSource {
  let loaded: ClaudeAgentSdkModule | null = null;
  let loading: Promise<ClaudeAgentSdkModule> | null = null;
  return {
    peek: () => loaded,
    ensure: () => {
      if (loaded) return Promise.resolve(loaded);
      loading ??= Promise.resolve()
        .then(load)
        .then(
          (sdk) => {
            loaded = sdk;
            return sdk;
          },
          (error: unknown) => {
            loading = null;
            throw error;
          },
        );
      return loading;
    },
  };
}

const sdkSource = createClaudeAgentSdkSource(() =>
  loadClaudeAgentSdk({
    runtimeDir: path.join(resolvePaseoHome(), "runtime-deps"),
    importLocal: () => import("@anthropic-ai/claude-agent-sdk"),
    fetchTarball: fetchFromRegistry,
    registry: claudeAgentSdkRegistry(process.env),
  }),
);

/** Reads the daemon's already loaded SDK without starting a download. */
export const peekClaudeAgentSdk = sdkSource.peek;
export const ensureClaudeAgentSdk = sdkSource.ensure;

export async function loadClaudeAgentSdk(
  options: LoadClaudeAgentSdkOptions,
): Promise<ClaudeAgentSdkModule> {
  try {
    return await options.importLocal();
  } catch (error) {
    if (!isModuleNotFound(error)) {
      throw error;
    }
  }

  const version = options.version ?? CLAUDE_AGENT_SDK_VERSION;
  try {
    return await loadManagedClaudeSdk({
      runtimeDir: options.runtimeDir,
      version,
      importInstalled: importInstalledSdk,
      install: async (directory) => {
        const bytes = await options.fetchTarball(tarballUrl(version, options.registry));
        verifyIntegrity(bytes, options.integrity ?? CLAUDE_AGENT_SDK_INTEGRITY);
        await extractTarball(bytes, directory);
      },
    });
  } catch (error) {
    if (
      error instanceof ClaudeAgentSdkDownloadError ||
      error instanceof ClaudeAgentSdkIntegrityError
    )
      throw error;
    throw new ClaudeAgentSdkRuntimeError();
  }
}

function tarballUrl(version: string, registry = "https://registry.npmjs.org/"): string {
  let base: URL;
  try {
    base = new URL(registry);
  } catch {
    throw new Error("Claude Agent SDK registry URL is invalid");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.href.includes("?") ||
    base.href.includes("#")
  ) {
    throw new Error(
      "Claude Agent SDK registry must be HTTP(S) without credentials, query or fragment",
    );
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-${version}.tgz`;
  return base.href;
}

function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND";
}

function verifyIntegrity(bytes: Uint8Array, integrity: string): void {
  const [algorithm, expected] = integrity.split("-", 2);
  const actual = createHash(algorithm).update(bytes).digest("base64");
  if (actual !== expected) {
    throw new ClaudeAgentSdkIntegrityError(integrity, `${algorithm}-${actual}`);
  }
}

/** Extracts into a scratch directory first so a half-written install is never visible. */
async function extractTarball(bytes: Uint8Array, installDir: string): Promise<void> {
  const scratch = `${installDir}.partial-${randomUUID()}`;
  const tarballPath = `${scratch}.tgz`;
  await mkdir(scratch, { recursive: true });
  try {
    await writeFile(tarballPath, bytes);
    await execCommand("tar", ["-xzf", tarballPath, "-C", scratch]);
    await rename(scratch, installDir);
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(tarballPath, { force: true });
  }
}

function installedEntry(installDir: string): string {
  return path.join(installDir, "package", "sdk.mjs");
}

async function importInstalledSdk(installDir: string): Promise<ClaudeAgentSdkModule> {
  const sdk: ClaudeAgentSdkModule = await import(pathToFileURL(installedEntry(installDir)).href);
  return sdk;
}
