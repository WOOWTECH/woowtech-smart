import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveConfigFromPersisted } from "./config.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { generateLocalPairingOffer } from "./pairing-offer.js";
import { editPersistedConfig } from "./persisted-config.js";
import { getOrCreateServerId } from "./server-id.js";

// woowtech smart's pairing links and QR codes open its hosted web app, as upstream's open
// its own (owner decision D2, 2026-10-26). A link is the web app's root with the offer in
// its fragment: the web app reads the offer there, and so do the app's scanner and its
// "Paste pairing link" field.
const WEB_APP_URL = "https://smart.woowtech.io";
const WEB_LINK_BASE = `${WEB_APP_URL}/`;
// The app's own link scheme, the default from 2026-09-25 to 2026-10-26 (0.8.1 included).
const APP_SCHEME_ROOT_URL = "woowtech-smart:///";

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
  test("a new home's pairing link opens the web app with the offer in its fragment", async () => {
    const home = await newHome();

    const link = await pairingLinkOf(home);

    expect(splitPairingLink(link)).toEqual({ base: WEB_LINK_BASE, offer: await offerOf(home) });
    const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
    expect(written.app).toEqual({ baseUrl: WEB_APP_URL });
  });

  test("an offer made without an app base URL opens the web app too", async () => {
    const home = await newHome();

    const pairing = await generateLocalPairingOffer({ paseoHome: home, includeQr: false });

    expect(splitPairingLink(pairing.url ?? "")).toEqual({
      base: WEB_LINK_BASE,
      offer: await offerOf(home),
    });
  });
});

// Homes created before this change carry a default an earlier release wrote: upstream's
// hosted web app (internal test builds) or the app's own link scheme (0.8.1). Nobody chose
// either, so both count as unset; every other value is the user's.
describe("app.baseUrl in an existing config.json", () => {
  test.each(["https://app.paseo.sh", "https://app.paseo.sh/", APP_SCHEME_ROOT_URL])(
    "the earlier default %s gets the web app link",
    async (earlierDefault) => {
      const home = await homeWithConfig({ version: 1, app: { baseUrl: earlierDefault } });

      expect(loadConfig(home, { env: {} }).appBaseUrl).toBe(WEB_APP_URL);
      expect(splitPairingLink(await pairingLinkOf(home))).toEqual({
        base: WEB_LINK_BASE,
        offer: await offerOf(home),
      });
    },
  );

  // The daemon's own web UI, a site of the user's, an app link with a host, and anything
  // that is not exactly an earlier default, even on upstream's host.
  test.each([
    "http://127.0.0.1:6770",
    "https://pair.example.test",
    "https://app.paseo.sh/pair",
    "woowtech-smart://pair",
  ])("a chosen value %s stays", async (chosen) => {
    const home = await homeWithConfig({ version: 1, app: { baseUrl: chosen } });

    expect(loadConfig(home, { env: {} }).appBaseUrl).toBe(chosen);
    expect(splitPairingLink(await pairingLinkOf(home)).base).toBe(`${chosen}/`);
  });

  // Only the exact strings an earlier release wrote count: no trimming, case folding or prefixes.
  test.each([
    " woowtech-smart:///",
    "woowtech-smart:/// ",
    "WOOWTECH-SMART:///",
    "woowtech-smart://",
    "https://app.paseo.sh//",
  ])("%j is not an earlier default and stays", async (chosen) => {
    const home = await homeWithConfig({ version: 1, app: { baseUrl: chosen } });

    expect(loadConfig(home, { env: {} }).appBaseUrl).toBe(chosen);
  });

  test("PASEO_APP_BASE_URL still wins over config.json", async () => {
    const home = await homeWithConfig({ version: 1, app: { baseUrl: "https://app.paseo.sh" } });

    const config = loadConfig(home, { env: { PASEO_APP_BASE_URL: "https://pair.example.test" } });

    expect(config.appBaseUrl).toBe("https://pair.example.test");
  });

  // PASEO_APP_BASE_URL is the way to keep handing out app links, so it is never migrated.
  test("PASEO_APP_BASE_URL set to the app's link scheme is used as it is", async () => {
    const home = await newHome();
    const env = { PASEO_APP_BASE_URL: APP_SCHEME_ROOT_URL };

    expect(loadConfig(home, { env }).appBaseUrl).toBe(APP_SCHEME_ROOT_URL);
    expect(splitPairingLink(await pairingLinkOf(home, env)).base).toBe(APP_SCHEME_ROOT_URL);
  });

  // `daemon config set` writes config.json and the running daemon re-resolves it.
  test.each(["https://app.paseo.sh/", APP_SCHEME_ROOT_URL])(
    "the same rule applies when the daemon reloads a config.json set to %s",
    async (earlierDefault) => {
      const home = await newHome();

      const edited = editPersistedConfig(home, "app.baseUrl", { value: earlierDefault });

      expect(resolveConfigFromPersisted(home, edited, { env: {} }).appBaseUrl).toBe(WEB_APP_URL);
    },
  );
});
