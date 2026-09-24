import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as ClaudeAgentSdk from "@anthropic-ai/claude-agent-sdk";

import { execCommand } from "../../../../utils/spawn.js";
import { resolvePaseoHome } from "../../../paseo-home.js";

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

export class ClaudeAgentSdkDownloadError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`Claude Agent SDK download from ${url} failed with HTTP ${status}`);
    this.name = "ClaudeAgentSdkDownloadError";
  }
}

export class ClaudeAgentSdkIntegrityError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Claude Agent SDK download failed its integrity check (expected ${expected}, got ${actual}); refusing to install it`,
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
  /** Subresource-integrity string of the tarball, e.g. `sha512-…`. */
  integrity?: string;
}

let loadedSdk: ClaudeAgentSdkModule | null = null;
let loadingSdk: Promise<ClaudeAgentSdkModule> | null = null;

/** The SDK if this daemon has already loaded it; never triggers a download. */
export function peekClaudeAgentSdk(): ClaudeAgentSdkModule | null {
  return loadedSdk;
}

/**
 * Loads the Claude Agent SDK once per daemon.
 *
 * woowtech smart does not ship the SDK: it is Anthropic's proprietary code
 * ("All rights reserved"), so the daemon fetches the pinned version from the npm
 * registry on first use, verifies it, and keeps it under $PASEO_HOME. Development
 * checkouts still resolve it from node_modules (it is a devDependency). A failed
 * attempt is not cached, so the next Claude session retries.
 */
export function ensureClaudeAgentSdk(): Promise<ClaudeAgentSdkModule> {
  if (loadedSdk) {
    return Promise.resolve(loadedSdk);
  }
  loadingSdk ??= loadClaudeAgentSdk({
    runtimeDir: path.join(resolvePaseoHome(), "runtime-deps"),
    importLocal: () => import("@anthropic-ai/claude-agent-sdk"),
    fetchTarball: fetchFromRegistry,
  }).then(
    (sdk) => {
      loadedSdk = sdk;
      return sdk;
    },
    (error: unknown) => {
      loadingSdk = null;
      throw error;
    },
  );
  return loadingSdk;
}

async function fetchFromRegistry(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new ClaudeAgentSdkDownloadError(url, response.status);
  }
  return new Uint8Array(await response.arrayBuffer());
}

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
  const installDir = path.join(options.runtimeDir, `claude-agent-sdk-${version}`);
  if (existsSync(installedEntry(installDir))) {
    return importInstalledSdk(installDir);
  }

  const bytes = await options.fetchTarball(tarballUrl(version));
  verifyIntegrity(bytes, options.integrity ?? CLAUDE_AGENT_SDK_INTEGRITY);
  await extractTarball(bytes, installDir);
  return importInstalledSdk(installDir);
}

function tarballUrl(version: string): string {
  return `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-${version}.tgz`;
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
