import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { type ClaudeAgentSdkModule, loadClaudeAgentSdk } from "./claude-agent-sdk-runtime.js";

let runtimeDir: string;
let scratchDir: string;

beforeEach(async () => {
  runtimeDir = await mkdtemp(path.join(tmpdir(), "claude-agent-sdk-runtime-"));
  scratchDir = await mkdtemp(path.join(tmpdir(), "claude-agent-sdk-tarball-"));
});

afterEach(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
  await rm(scratchDir, { recursive: true, force: true });
});

async function missingLocalSdk(): Promise<ClaudeAgentSdkModule> {
  throw Object.assign(new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
}

/** Builds an npm-style tarball (`package/sdk.mjs`) the way the registry serves one. */
async function makeSdkTarball(
  sdkSource: string,
): Promise<{ bytes: Uint8Array; integrity: string }> {
  const packageDir = path.join(scratchDir, "src", "package");
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, "package.json"), '{"type":"module","main":"sdk.mjs"}');
  await writeFile(path.join(packageDir, "sdk.mjs"), sdkSource);
  const tarballPath = path.join(scratchDir, "sdk.tgz");
  execFileSync("tar", ["-czf", tarballPath, "-C", path.join(scratchDir, "src"), "package"]);
  const bytes = new Uint8Array(await readFile(tarballPath));
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  return { bytes, integrity };
}

describe("loadClaudeAgentSdk", () => {
  test("uses the locally installed SDK without downloading", async () => {
    const localSdk = { source: "local" } as unknown as ClaudeAgentSdkModule;
    const fetchTarball = vi.fn(async () => new Uint8Array());

    const sdk = await loadClaudeAgentSdk({
      runtimeDir,
      importLocal: async () => localSdk,
      fetchTarball,
    });

    expect(sdk).toBe(localSdk);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  test("downloads, verifies and loads the SDK when it is not installed locally", async () => {
    const tarball = await makeSdkTarball('export const source = "downloaded";');

    const sdk = await loadClaudeAgentSdk({
      runtimeDir,
      importLocal: missingLocalSdk,
      fetchTarball: async () => tarball.bytes,
      integrity: tarball.integrity,
    });

    expect((sdk as unknown as { source: string }).source).toBe("downloaded");
  });

  test("refuses a tarball whose integrity does not match and installs nothing", async () => {
    const tampered = await makeSdkTarball('export const source = "tampered";');
    const genuine = await makeSdkTarball('export const source = "genuine";');

    await expect(
      loadClaudeAgentSdk({
        runtimeDir,
        importLocal: missingLocalSdk,
        fetchTarball: async () => tampered.bytes,
        integrity: genuine.integrity,
      }),
    ).rejects.toThrow(/integrity/i);

    const sdk = await loadClaudeAgentSdk({
      runtimeDir,
      importLocal: missingLocalSdk,
      fetchTarball: async () => genuine.bytes,
      integrity: genuine.integrity,
    });
    expect((sdk as unknown as { source: string }).source).toBe("genuine");
  });

  test("reuses a previously downloaded copy without going back to the network", async () => {
    const tarball = await makeSdkTarball('export const source = "downloaded";');
    await loadClaudeAgentSdk({
      runtimeDir,
      importLocal: missingLocalSdk,
      fetchTarball: async () => tarball.bytes,
      integrity: tarball.integrity,
    });

    const offlineFetch = vi.fn(async (): Promise<Uint8Array> => {
      throw new Error("offline");
    });
    const sdk = await loadClaudeAgentSdk({
      runtimeDir,
      importLocal: missingLocalSdk,
      fetchTarball: offlineFetch,
      integrity: tarball.integrity,
    });

    expect((sdk as unknown as { source: string }).source).toBe("downloaded");
    expect(offlineFetch).not.toHaveBeenCalled();
  });
});
