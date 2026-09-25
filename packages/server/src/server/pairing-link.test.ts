import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveConfigFromPersisted } from "./config.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { generateLocalPairingOffer } from "./pairing-offer.js";
import { editPersistedConfig } from "./persisted-config.js";
import { getOrCreateServerId } from "./server-id.js";

// woowtech smart's pairing links and QR codes open the app itself through its own
// link scheme (owner decision 直接叫起 App). A link is the app's root URL with the
// offer in its fragment: the app lands on its index route and reads the offer there.
const APP_ROOT_URL = "woowtech-smart:///";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function newHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "woowtech-pairing-link-"));
  roots.push(home);
  return home;
}

async function homeWithConfig(config: unknown): Promise<string> {
  const home = await newHome();
  await writeFile(path.join(home, "config.json"), JSON.stringify(config, null, 2));
  return home;
}

/** The pairing link the daemon in `home` hands out, as `daemon pair` and the desktop get it. */
async function pairingLinkOf(home: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  const config = loadConfig(home, { env });
  const pairing = await generateLocalPairingOffer({
    paseoHome: home,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: false,
  });
  return pairing.url ?? "";
}

/** A link cut at its `#offer=` marker, the way the app's consumers read it. */
function splitPairingLink(link: string): { base: string; offer: unknown } {
  const marker = "#offer=";
  const index = link.indexOf(marker);
  return {
    base: index === -1 ? link : link.slice(0, index),
    offer:
      index === -1
        ? null
        : JSON.parse(Buffer.from(link.slice(index + marker.length), "base64url").toString("utf8")),
  };
}

async function offerOf(home: string): Promise<unknown> {
  return {
    v: 2,
    serverId: getOrCreateServerId(home, { env: {} }),
    daemonPublicKeyB64: (await loadOrCreateDaemonKeyPair(home)).publicKeyB64,
    relay: { endpoint: "relay.woowtech.io:443", useTls: true },
  };
}

describe("woowtech smart pairing links", () => {
  test("a new home's pairing link opens the app with the offer in its fragment", async () => {
    const home = await newHome();

    const link = await pairingLinkOf(home);

    expect(splitPairingLink(link)).toEqual({ base: APP_ROOT_URL, offer: await offerOf(home) });
    const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
    expect(written.app).toEqual({ baseUrl: APP_ROOT_URL });
  });

  test("an offer made without an app base URL opens the app too", async () => {
    const home = await newHome();

    const pairing = await generateLocalPairingOffer({ paseoHome: home, includeQr: false });

    expect(splitPairingLink(pairing.url ?? "")).toEqual({
      base: APP_ROOT_URL,
      offer: await offerOf(home),
    });
  });
});

// Homes created before this change carry upstream's default app.baseUrl, which
// sends the QR code to upstream's hosted web app. Nobody chose that value, so it
// counts as unset; every other value is the user's.
describe("app.baseUrl in an existing config.json", () => {
  test.each(["https://app.paseo.sh", "https://app.paseo.sh/"])(
    "upstream's default %s gets the app link",
    async (upstreamDefault) => {
      const home = await homeWithConfig({ version: 1, app: { baseUrl: upstreamDefault } });

      expect(loadConfig(home, { env: {} }).appBaseUrl).toBe(APP_ROOT_URL);
      expect(splitPairingLink(await pairingLinkOf(home))).toEqual({
        base: APP_ROOT_URL,
        offer: await offerOf(home),
      });
    },
  );

  // The daemon's own web UI, a site of the user's, and anything that is not exactly
  // upstream's default, even on upstream's host.
  test.each(["http://127.0.0.1:6770", "https://pair.example.test", "https://app.paseo.sh/pair"])(
    "a chosen value %s stays",
    async (chosen) => {
      const home = await homeWithConfig({ version: 1, app: { baseUrl: chosen } });

      expect(loadConfig(home, { env: {} }).appBaseUrl).toBe(chosen);
      expect(splitPairingLink(await pairingLinkOf(home)).base).toBe(`${chosen}/`);
    },
  );

  test("PASEO_APP_BASE_URL still wins over config.json", async () => {
    const home = await homeWithConfig({ version: 1, app: { baseUrl: "https://app.paseo.sh" } });

    const config = loadConfig(home, { env: { PASEO_APP_BASE_URL: "https://pair.example.test" } });

    expect(config.appBaseUrl).toBe("https://pair.example.test");
  });

  // `daemon config set` writes config.json and the running daemon re-resolves it.
  test("the same rule applies when the daemon reloads config.json", async () => {
    const home = await newHome();

    const edited = editPersistedConfig(home, "app.baseUrl", { value: "https://app.paseo.sh/" });

    expect(resolveConfigFromPersisted(home, edited, { env: {} }).appBaseUrl).toBe(APP_ROOT_URL);
  });
});
