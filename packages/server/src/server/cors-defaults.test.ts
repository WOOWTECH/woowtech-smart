import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveConfigFromPersisted } from "./config.js";
import { editPersistedConfig, readPersistedConfig } from "./persisted-config.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

// Upstream's new homes let its hosted web app talk to the local daemon from the user's
// browser, over HTTP and WebSocket, and the daemon has no password by default. woowtech
// smart's new homes let in its own hosted web app instead, and nothing else (owner decision
// D3, 2026-10-26; the owner accepted that a compromised site could then drive a visitor's
// daemon). The value is written into config.json, so "[]" there turns it off. The desktop app
// and the daemon's own web UI are let in by the daemon itself; dev setups add their origins in
// config.json or PASEO_CORS_ORIGINS.
const HOSTED_WEB_APP = "https://smart.woowtech.io";
const UPSTREAM_WEB_APP = "https://app.paseo.sh";
const DESKTOP_APP = "woowtech-smart://app";
const DEV_ORIGIN = "http://localhost:8081";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function newHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "woowtech-cors-"));
  roots.push(home);
  return home;
}

async function homeWithConfig(config: unknown): Promise<string> {
  const home = await newHome();
  await writeFile(path.join(home, "config.json"), JSON.stringify(config, null, 2));
  return home;
}

/** The origin the daemon grants to a browser request from `origin`, or null. */
async function grantedHttpOrigin(port: number, origin: string): Promise<string | null> {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { Origin: origin },
  });
  return response.headers.get("access-control-allow-origin");
}

/** "open", or the HTTP status the daemon refuses a WebSocket from `origin` with. */
function webSocketFrom(port: number, origin: string): Promise<"open" | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin } });
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (request, response) => {
      request.destroy();
      resolve(response.statusCode ?? 0);
    });
    ws.on("error", reject);
  });
}

/** What the daemon on `port` lets a browser page at `origin` do. */
async function accessFrom(
  port: number,
  origin: string,
): Promise<{ granted: string | null; webSocket: "open" | number }> {
  return {
    granted: await grantedHttpOrigin(port, origin),
    webSocket: await webSocketFrom(port, origin),
  };
}

describe("the web origins a new home lets in", () => {
  test("the hosted web app: config.json starts with it", async () => {
    const home = await newHome();

    expect(loadConfig(home, { env: {} }).corsAllowedOrigins).toEqual([HOSTED_WEB_APP]);
    const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
    expect(written.daemon.cors).toEqual({ allowedOrigins: [HOSTED_WEB_APP] });
  });

  // `daemon pair`, `daemon status` and onboard read the defaults without creating the home.
  test("the CLI's defaults for a home that does not exist yet have it too", async () => {
    const home = path.join(await newHome(), "not-created");

    const defaults = readPersistedConfig(home, { defaultsIfMissing: true });

    expect(defaults.daemon?.cors?.allowedOrigins).toEqual([HOSTED_WEB_APP]);
    expect(existsSync(home)).toBe(false);
  });

  test("origins a dev setup or the user adds still count", async () => {
    // scripts/dev-home.sh writes "*"; scripts/dev-daemon.sh sets PASEO_CORS_ORIGINS.
    const devHome = await homeWithConfig({
      version: 1,
      daemon: { cors: { allowedOrigins: ["*"] } },
    });
    expect(loadConfig(devHome, { env: {} }).corsAllowedOrigins).toEqual(["*"]);

    const config = loadConfig(await newHome(), {
      env: { PASEO_CORS_ORIGINS: DEV_ORIGIN },
    });
    expect(config.corsAllowedOrigins).toEqual([HOSTED_WEB_APP, DEV_ORIGIN]);
  });

  test("the daemon lets in the hosted web app, the desktop app and its own web UI", async () => {
    const { corsAllowedOrigins } = loadConfig(await newHome(), { env: {} });
    const daemon = await createTestPaseoDaemon({ corsAllowedOrigins });
    try {
      expect(await accessFrom(daemon.port, HOSTED_WEB_APP)).toEqual({
        granted: HOSTED_WEB_APP,
        webSocket: "open",
      });
      expect(await grantedHttpOrigin(daemon.port, DESKTOP_APP)).toBe(DESKTOP_APP);
      expect(await webSocketFrom(daemon.port, DESKTOP_APP)).toBe("open");
      expect(await webSocketFrom(daemon.port, `http://127.0.0.1:${daemon.port}`)).toBe("open");
    } finally {
      await daemon.close();
    }
  });

  // The daemon compares the Origin header as a string: only the exact origin gets in.
  test("the daemon refuses upstream's web app and every look-alike of ours", async () => {
    const { corsAllowedOrigins } = loadConfig(await newHome(), { env: {} });
    const daemon = await createTestPaseoDaemon({ corsAllowedOrigins });
    const refused = { granted: null, webSocket: 403 };
    try {
      for (const origin of [
        UPSTREAM_WEB_APP,
        `${HOSTED_WEB_APP}/`,
        "http://smart.woowtech.io",
        "https://smart.woowtech.io:8443",
        "https://x.smart.woowtech.io",
        "https://smart.woowtech.io.evil.test",
        "https://woowtech-smart-web.pages.dev",
      ]) {
        expect({ origin, ...(await accessFrom(daemon.port, origin)) }).toEqual({
          origin,
          ...refused,
        });
      }
    } finally {
      await daemon.close();
    }
  });
});

// "[]" is the one way to turn the hosted web app's direct connection off, so it has to stay
// empty: the daemon never adds the hosted web app back while resolving the config.
describe("turning the hosted web app's direct connection off", () => {
  test("a home that lists no origins refuses it", async () => {
    const home = await homeWithConfig({ version: 1, daemon: { cors: { allowedOrigins: [] } } });
    const { corsAllowedOrigins } = loadConfig(home, { env: {} });
    expect(corsAllowedOrigins).toEqual([]);

    const daemon = await createTestPaseoDaemon({ corsAllowedOrigins });
    try {
      expect(await accessFrom(daemon.port, HOSTED_WEB_APP)).toEqual({
        granted: null,
        webSocket: 403,
      });
    } finally {
      await daemon.close();
    }
  });

  // `daemon config set daemon.cors.allowedOrigins '[]'` writes config.json, and the running
  // daemon re-resolves it.
  test("setting the list to [] holds after the daemon reloads config.json", async () => {
    const home = await newHome();
    expect(loadConfig(home, { env: {} }).corsAllowedOrigins).toEqual([HOSTED_WEB_APP]);

    const edited = editPersistedConfig(home, "daemon.cors.allowedOrigins", { value: [] });

    expect(resolveConfigFromPersisted(home, edited, { env: {} }).corsAllowedOrigins).toEqual([]);
  });

  test("a config.json without daemon.cors lets no web origin in", async () => {
    const home = await homeWithConfig({ version: 1, daemon: { listen: "127.0.0.1:6768" } });

    expect(loadConfig(home, { env: {} }).corsAllowedOrigins).toEqual([]);
  });
});
