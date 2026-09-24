// woowtech smart has no relay of its own yet, so the daemon must not connect to
// upstream's relay.paseo.sh unless the user turns the relay on. Upstream turns the
// relay on for any config.json that omits daemon.relay.enabled, and a merge can
// bring that back in packages/server/src/server/config.ts. These checks call the
// daemon's config resolver from source through tsx, because packages/server/dist
// is built separately and is often older than the checkout, as it is right after a
// merge.
//
//   node --test woowtech/relay.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { tsImport } from "tsx/esm/api";

const { loadConfig } = await tsImport("../packages/server/src/server/config.ts", import.meta.url);

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

/** Whether the daemon starts its relay, ignoring the PASEO_* variables of this shell. */
function relayEnabled(home, env = {}) {
  return loadConfig(home, { env }).relayEnabled;
}

test("the daemon keeps the relay off unless the user turns it on", () => {
  assert.equal(relayEnabled(daemonHome()), false, "a new home");
  assert.equal(
    relayEnabled(daemonHome({ version: 1, daemon: { listen: "127.0.0.1:6768" } })),
    false,
    "a config.json without daemon.relay, like the one scripts/dev-home.sh writes",
  );
  assert.equal(
    relayEnabled(daemonHome({ version: 1, daemon: { relay: {} } })),
    false,
    "a relay block without enabled",
  );
});

test("the user can still turn the relay on", () => {
  assert.equal(
    relayEnabled(daemonHome({ version: 1, daemon: { relay: { enabled: true } } })),
    true,
    "daemon.relay.enabled in config.json",
  );
  assert.equal(
    relayEnabled(daemonHome({ version: 1 }), { PASEO_RELAY_ENABLED: "true" }),
    true,
    "PASEO_RELAY_ENABLED for a foreground deployment",
  );
});
