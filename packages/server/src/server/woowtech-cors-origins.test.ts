import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveConfigFromPersisted } from "./config.js";
import { editPersistedConfig } from "./persisted-config.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { withoutUpstreamWebApp } from "./woowtech-cors-origins.js";

// Homes created by internal test builds still list upstream's hosted web app in
// daemon.cors.allowedOrigins. woowtech smart drops it whenever it resolves the config, so
// that site cannot reach the daemon from the user's browser, and leaves config.json alone.
const UPSTREAM_WEB_APP = "https://app.paseo.sh";
const DEV_ORIGIN = "http://localhost:8081";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function homeWithCorsOrigins(allowedOrigins: string[]): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "woowtech-cors-origins-"));
  roots.push(home);
  const config = { version: 1, daemon: { cors: { allowedOrigins } } };
  await writeFile(path.join(home, "config.json"), JSON.stringify(config, null, 2));
  return home;
}

async function originsInConfigJson(home: string): Promise<unknown> {
  const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
  return written.daemon.cors.allowedOrigins;
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

describe("withoutUpstreamWebApp", () => {
  test("drops upstream's web app, with or without a trailing slash", () => {
    expect(withoutUpstreamWebApp([UPSTREAM_WEB_APP, `${UPSTREAM_WEB_APP}/`])).toEqual([]);
  });

  test("keeps every other origin in its order, even ones on upstream's host", () => {
    const others = [
      DEV_ORIGIN,
      "*",
      "woowtech-smart://app",
      "http://app.paseo.sh",
      "https://app.paseo.sh:8443",
      "https://preview.app.paseo.sh",
      "https://app.paseo.sh/pair",
    ];

    expect(withoutUpstreamWebApp([others[0], UPSTREAM_WEB_APP, ...others.slice(1)])).toEqual(
      others,
    );
  });
});

describe("CORS origins of a home from an internal test build", () => {
  test("upstream's web app is not let in; config.json still lists it", async () => {
    const home = await homeWithCorsOrigins([UPSTREAM_WEB_APP, DEV_ORIGIN, `${UPSTREAM_WEB_APP}/`]);

    expect(loadConfig(home, { env: {} }).corsAllowedOrigins).toEqual([DEV_ORIGIN]);
    expect(await originsInConfigJson(home)).toEqual([
      UPSTREAM_WEB_APP,
      DEV_ORIGIN,
      `${UPSTREAM_WEB_APP}/`,
    ]);
  });

  test("PASEO_CORS_ORIGINS cannot let it in either", async () => {
    const home = await homeWithCorsOrigins([]);

    const config = loadConfig(home, {
      env: { PASEO_CORS_ORIGINS: `${UPSTREAM_WEB_APP}, ${DEV_ORIGIN}` },
    });

    expect(config.corsAllowedOrigins).toEqual([DEV_ORIGIN]);
  });

  // `daemon config set` writes config.json and the running daemon re-resolves it.
  test("the same rule applies when the daemon reloads config.json", async () => {
    const home = await homeWithCorsOrigins([]);

    const edited = editPersistedConfig(home, "daemon.cors.allowedOrigins", {
      value: [UPSTREAM_WEB_APP, DEV_ORIGIN],
    });

    expect(resolveConfigFromPersisted(home, edited, { env: {} }).corsAllowedOrigins).toEqual([
      DEV_ORIGIN,
    ]);
  });

  test("the daemon refuses upstream's web app and still lets in the origins the user kept", async () => {
    const home = await homeWithCorsOrigins([UPSTREAM_WEB_APP, DEV_ORIGIN]);
    const { corsAllowedOrigins } = loadConfig(home, { env: {} });
    const daemon = await createTestPaseoDaemon({ corsAllowedOrigins });
    try {
      expect(await grantedHttpOrigin(daemon.port, UPSTREAM_WEB_APP)).toBeNull();
      expect(await webSocketFrom(daemon.port, UPSTREAM_WEB_APP)).toBe(403);

      expect(await grantedHttpOrigin(daemon.port, DEV_ORIGIN)).toBe(DEV_ORIGIN);
      expect(await webSocketFrom(daemon.port, DEV_ORIGIN)).toBe("open");
    } finally {
      await daemon.close();
    }
  });
});
