import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

// Upstream's new homes let its hosted web app talk to the local daemon from the
// user's browser, over HTTP and WebSocket, and the daemon has no password by default.
// woowtech smart's pairing links open the app itself, so a new home lets in no web
// origin. The desktop app and the daemon's own web UI are let in by the daemon
// itself; dev setups add their origins in config.json or PASEO_CORS_ORIGINS.
const UPSTREAM_WEB_APP = "https://app.paseo.sh";
const DESKTOP_APP = "woowtech-smart://app";

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

describe("the web origins a new home lets in", () => {
  test("none: config.json starts with an empty list", async () => {
    const home = await newHome();

    expect(loadConfig(home, { env: {} }).corsAllowedOrigins).toEqual([]);
    const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
    expect(written.daemon.cors).toEqual({ allowedOrigins: [] });
  });

  test("origins a dev setup or the user adds still count", async () => {
    // scripts/dev-home.sh writes "*"; scripts/dev-daemon.sh sets PASEO_CORS_ORIGINS.
    const devHome = await homeWithConfig({
      version: 1,
      daemon: { cors: { allowedOrigins: ["*"] } },
    });
    expect(loadConfig(devHome, { env: {} }).corsAllowedOrigins).toEqual(["*"]);

    const config = loadConfig(await newHome(), {
      env: { PASEO_CORS_ORIGINS: "http://localhost:8081" },
    });
    expect(config.corsAllowedOrigins).toEqual(["http://localhost:8081"]);
  });

  test("the daemon refuses upstream's web app and still lets in the desktop app and its own web UI", async () => {
    const { corsAllowedOrigins } = loadConfig(await newHome(), { env: {} });
    const daemon = await createTestPaseoDaemon({ corsAllowedOrigins });
    try {
      expect(await grantedHttpOrigin(daemon.port, UPSTREAM_WEB_APP)).toBeNull();
      expect(await webSocketFrom(daemon.port, UPSTREAM_WEB_APP)).toBe(403);

      expect(await grantedHttpOrigin(daemon.port, DESKTOP_APP)).toBe(DESKTOP_APP);
      expect(await webSocketFrom(daemon.port, DESKTOP_APP)).toBe("open");
      expect(await webSocketFrom(daemon.port, `http://127.0.0.1:${daemon.port}`)).toBe("open");
    } finally {
      await daemon.close();
    }
  });
});
