// woowtech smart runs its own relay at relay.woowtech.io (packages/relay/
// wrangler.woowtech.toml, guarded by relay-worker.test.mjs), so the daemon connects
// to it unless the user turns the relay off. Upstream's daemon connects to
// upstream's relay.paseo.sh and writes the relay off into new homes; a merge can
// bring either back in packages/server/src/server/config.ts, persisted-config.ts,
// pairing-offer.ts or bootstrap.ts. These checks call the daemon's config resolver
// and pairing offer from source through tsx, because packages/server/dist is built
// separately and is often older than the checkout, as it is right after a merge.
// Their imports from other packages (the endpoint comes from @getpaseo/protocol)
// read those packages' dist, so build them first (README, 分支與上游).
//
//   node --test woowtech/relay.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { tsImport } from "tsx/esm/api";

import { findInShippedSources } from "./shipped-sources.mjs";

const { loadConfig } = await tsImport("../packages/server/src/server/config.ts", import.meta.url);
const { editPersistedConfig } = await tsImport(
  "../packages/server/src/server/persisted-config.ts",
  import.meta.url,
);
const { generateLocalPairingOffer } = await tsImport(
  "../packages/server/src/server/pairing-offer.ts",
  import.meta.url,
);
const { parseConnectionOfferFromUrl } = await tsImport(
  "../packages/protocol/src/connection-offer.ts",
  import.meta.url,
);

const OUR_RELAY = "relay.woowtech.io:443";

const homes = [];
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A daemon home with `config` as its config.json, or with no config.json at all. */
function daemonHome(config) {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-relay-"));
  homes.push(home);
  if (config !== undefined) {
    writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
  }
  return home;
}

/** The daemon's relay settings, ignoring the PASEO_* variables of this shell. */
function relayOf(home, env = {}) {
  const config = loadConfig(home, { env });
  return {
    enabled: config.relayEnabled,
    endpoint: config.relayEndpoint,
    useTls: config.relayUseTls,
  };
}

test("the daemon turns the relay on and connects to relay.woowtech.io", () => {
  const on = { enabled: true, endpoint: OUR_RELAY, useTls: true };
  const newHome = daemonHome();
  assert.deepEqual(relayOf(newHome), on, "a new home");
  const written = JSON.parse(readFileSync(path.join(newHome, "config.json"), "utf8"));
  assert.equal(written.daemon.relay.enabled, true, "the config.json a new home gets");
  assert.deepEqual(
    relayOf(daemonHome({ version: 1, daemon: { listen: "127.0.0.1:6768" } })),
    on,
    "a config.json without daemon.relay, like the one scripts/dev-home.sh writes",
  );
  assert.deepEqual(
    relayOf(daemonHome({ version: 1, daemon: { relay: {} } })),
    on,
    "a relay block without enabled",
  );
});

test("the relay stays off when the user turns it off", () => {
  assert.equal(
    relayOf(daemonHome({ version: 1, daemon: { relay: { enabled: false } } })).enabled,
    false,
    "daemon.relay.enabled: false in config.json",
  );
  assert.equal(
    relayOf(daemonHome({ version: 1 }), { PASEO_RELAY_ENABLED: "false" }).enabled,
    false,
    "PASEO_RELAY_ENABLED for a foreground deployment",
  );
  const home = daemonHome();
  editPersistedConfig(home, "daemon.relay.enabled", { value: false });
  assert.equal(relayOf(home).enabled, false, "woowtech-smart daemon config set");
});

test("pairing offers send phones to relay.woowtech.io", async () => {
  const home = daemonHome();
  const config = loadConfig(home, { env: {} });
  for (const args of [
    { paseoHome: home },
    {
      paseoHome: home,
      relayEndpoint: config.relayEndpoint,
      relayPublicEndpoint: config.relayPublicEndpoint,
      relayUseTls: config.relayUseTls,
      relayPublicUseTls: config.relayPublicUseTls,
    },
  ]) {
    const pairing = await generateLocalPairingOffer({ ...args, includeQr: false });
    assert.deepEqual(parseConnectionOfferFromUrl(pairing.url).relay, {
      endpoint: OUR_RELAY,
      useTls: true,
    });
  }
});

test("no shipped source names upstream's relay", () => {
  assert.deepEqual(
    findInShippedSources([/relay\.paseo\.sh/], {
      files: [
        "packages/relay/src/cloudflare-adapter.ts",
        "packages/relay/src/cutover-proxy.ts",
        "packages/relay/wrangler.woowtech.toml",
      ],
    }),
    [],
  );
});
