import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createServer } from "node:http";
import type { Socket } from "node:net";

import { claudeAgentSdkRegistry, fetchFromRegistry } from "./claude-agent-sdk-download.js";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type ClaudeAgentSdkModule,
  loadClaudeAgentSdk,
  CLAUDE_AGENT_SDK_INTEGRITY,
} from "./claude-agent-sdk-runtime.js";

let runtimeDir: string;
let scratchDir: string;

beforeEach(async () => {
  const tempRoot = path.resolve(".dev/f11-repair/fixtures");
  await mkdir(tempRoot, { recursive: true });
  runtimeDir = await mkdtemp(path.join(tempRoot, "claude-agent-sdk-runtime-"));
  scratchDir = await mkdtemp(path.join(tempRoot, "claude-agent-sdk-tarball-"));
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
  test.each(["https://mirror.invalid/npm", "https://mirror.invalid/npm/"])(
    "uses registry subpath %s without consulting metadata",
    async (registry) => {
      const tarball = await makeSdkTarball('export const source = "mirror";');
      const urls: string[] = [];
      await loadClaudeAgentSdk({
        runtimeDir,
        importLocal: missingLocalSdk,
        registry,
        fetchTarball: async (url) => {
          urls.push(url);
          return tarball.bytes;
        },
        integrity: tarball.integrity,
      });
      expect(urls).toEqual([
        "https://mirror.invalid/npm/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.246.tgz",
      ]);
    },
  );
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

test("registry environment uses lowercase first and the uppercase fallback", () => {
  expect(claudeAgentSdkRegistry({})).toBeUndefined();
  expect(claudeAgentSdkRegistry({ NPM_CONFIG_REGISTRY: "upper" })).toBe("upper");
  expect(
    claudeAgentSdkRegistry({ npm_config_registry: "lower", NPM_CONFIG_REGISTRY: "upper" }),
  ).toBe("lower");
});

test.each([
  "https://mirror.invalid/?",
  "https://mirror.invalid/#",
  "file:///fixture",
  "not a URL",
  "https://fixture-user:fixture-password@mirror.invalid/",
  "https://mirror.invalid/?fixture-query",
  "https://mirror.invalid/#fixture-fragment",
])("refuses unsafe registry configuration without leaking it: %s", async (registry) => {
  let calls = 0;
  const error = await loadClaudeAgentSdk({
    runtimeDir,
    registry,
    importLocal: missingLocalSdk,
    fetchTarball: async () => {
      calls++;
      return new Uint8Array();
    },
  }).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toMatch(/fixture|mirror.invalid/);
  expect(calls).toBe(0);
});

test("a mirror cannot replace the pinned integrity with its own bytes", async () => {
  const tarball = await makeSdkTarball('export const source = "not-the-pinned-sdk";');
  const urls: string[] = [];
  await expect(
    loadClaudeAgentSdk({
      runtimeDir,
      registry: "https://mirror.invalid/repository",
      importLocal: missingLocalSdk,
      fetchTarball: async (url) => {
        urls.push(url);
        return tarball.bytes;
      },
    }),
  ).rejects.toMatchObject({
    name: "ClaudeAgentSdkIntegrityError",
    expected: CLAUDE_AGENT_SDK_INTEGRITY,
  });
  expect(urls).toEqual([
    "https://mirror.invalid/repository/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.246.tgz",
  ]);
});

test.each(["non-2xx", "disconnect", "slow-body", "wrong-sha512"])(
  "loopback mirror %s failure installs nothing; next attempt loads verified synthetic SDK",
  async (failure) => {
    const tarball = await makeSdkTarball('export const source = "loopback mirror";');
    const paths: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer((req, res) => {
      paths.push(req.url ?? "");
      if (paths.length === 1) {
        switch (failure) {
          case "non-2xx":
            res.writeHead(502);
            res.end();
            return;
          case "disconnect":
            res.socket?.destroy();
            return;
          case "slow-body":
            res.writeHead(200);
            res.write("partial");
            return;
          case "wrong-sha512":
            res.end("untrusted mirror bytes");
            return;
        }
      }
      res.end(tarball.bytes);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    try {
      const options = {
        runtimeDir,
        registry: `http://127.0.0.1:${address.port}/mirror/`,
        importLocal: missingLocalSdk,
        integrity: tarball.integrity,
        fetchTarball: (url: string) => fetchFromRegistry(url, { env: {}, timeoutMs: 150 }),
      };
      await expect(loadClaudeAgentSdk(options)).rejects.toThrow(
        failure === "wrong-sha512" ? "integrity check" : "download failed",
      );
      expect(await readdir(runtimeDir)).toEqual([]);
      const sdk = await loadClaudeAgentSdk(options);
      expect((sdk as unknown as { source: string }).source).toBe("loopback mirror");
      expect(paths).toEqual(
        Array(2).fill("/mirror/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.246.tgz"),
      );
      const pointerName = "claude-agent-sdk-0.3.246.json";
      const generation: unknown = JSON.parse(
        await readFile(path.join(runtimeDir, pointerName), "utf8"),
      );
      expect(generation).toMatch(/^claude-agent-sdk-0\.3\.246\.generation-[0-9a-f-]{36}$/);
      expect(await readdir(runtimeDir)).toEqual([generation, pointerName]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    }
  },
);
