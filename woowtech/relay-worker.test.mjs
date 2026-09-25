// woowtech smart runs its own relay: a Cloudflare Worker in WoowTech's account at
// relay.woowtech.io, deployed with packages/relay/wrangler.woowtech.toml. Upstream's
// packages/relay/wrangler.toml deploys the same Worker to upstream's account, where
// PASEO_RELAY_UPSTREAM makes it forward every request to upstream's relay on Fly.
// These checks read our config the way `wrangler deploy --config` reads it, and run
// the Worker with that config's variables, so an edit or a merge that makes our relay
// forward to upstream, or deploy to another account or domain, fails here.
//
//   node --test woowtech/relay-worker.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tsImport } from "tsx/esm/api";
import { experimental_readRawConfig, unstable_readConfig } from "wrangler";

import { repoRoot } from "./shipped-sources.mjs";

const relayDir = path.join(repoRoot, "packages/relay");
const OUR_CONFIG = path.join(relayDir, "wrangler.woowtech.toml");
const UPSTREAM_CONFIG = path.join(relayDir, "wrangler.toml");
const WOOWTECH_ACCOUNT_ID = "9c27f623ee596e0b67be56263bcb1974";
const RELAY_HOST = "relay.woowtech.io";

const { default: relayWorker } = await tsImport(
  "../packages/relay/src/cloudflare-adapter.ts",
  import.meta.url,
);

function readConfig(configPath) {
  return unstable_readConfig({ config: configPath }, { hideWarnings: true });
}

/**
 * Runs the Worker's fetch handler with `vars` as its variables and a stand-in for
 * the RELAY Durable Object namespace. Returns the response, the Durable Object
 * names the Worker routed to, and every URL it fetched on the network.
 */
async function runWorker(vars, url) {
  const routedTo = [];
  const namespace = {
    idFromName: (name) => ({ name, toString: () => name }),
    get: (id) => ({
      fetch: async () => {
        routedTo.push(id.name);
        return new Response("relayed by the Durable Object", { status: 200 });
      },
    }),
  };
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    return new Response("forwarded", { status: 200 });
  };
  try {
    const response = await relayWorker.fetch(new Request(url), { ...vars, RELAY: namespace });
    return { response, routedTo, fetched };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("our Worker config deploys the relay to WoowTech's account at relay.woowtech.io only", () => {
  const config = readConfig(OUR_CONFIG);
  assert.equal(config.name, "woowtech-smart-relay");
  assert.equal(config.account_id, WOOWTECH_ACCOUNT_ID);
  assert.deepEqual(config.routes, [{ pattern: RELAY_HOST, custom_domain: true }]);
  assert.equal(config.workers_dev, false, "no second address on workers.dev");
});

test("our Worker config never forwards to upstream's relay", async () => {
  const { rawConfig } = experimental_readRawConfig({ config: OUR_CONFIG });
  assert.equal(rawConfig.env, undefined, "no [env.*] variant that `--env` could deploy");
  assert.notEqual(rawConfig.keep_vars, true, "a deploy must reset variables set in the dashboard");

  const { vars } = readConfig(OUR_CONFIG);
  assert.equal(vars.PASEO_RELAY_UPSTREAM, undefined);

  const health = await runWorker(vars, `https://${RELAY_HOST}/health`);
  assert.deepEqual(health.fetched, []);
  assert.deepEqual(await health.response.json(), { status: "ok" });

  const daemon = await runWorker(
    vars,
    `https://${RELAY_HOST}/ws?serverId=srv_guard&role=server&v=2`,
  );
  assert.deepEqual(daemon.fetched, []);
  assert.deepEqual(daemon.routedTo, ["relay-v2:srv_guard"]);

  // The same run with upstream's variables forwards, so this check sees forwarding.
  const upstream = await runWorker(
    readConfig(UPSTREAM_CONFIG).vars,
    `https://${RELAY_HOST}/health`,
  );
  assert.equal(upstream.fetched.length, 1);
  assert.notEqual(new URL(upstream.fetched[0]).host, RELAY_HOST);
});

test("the relay's e2e test runs our Worker config", () => {
  // With upstream's config, `wrangler dev --local` forwards the test's traffic to
  // upstream's relay on Fly, and the test proves nothing about ours.
  const harness = readFileSync(path.join(relayDir, "src/e2e.test.ts"), "utf8");
  assert.match(harness, /"--config",\s*"wrangler\.woowtech\.toml",/);
});

test("our Worker runs upstream's relay: same code, Durable Object, migrations and logs", () => {
  // When upstream renames the Durable Object or adds a migration, ours has to follow,
  // or the next deploy fails or strands the existing sessions.
  const ours = readConfig(OUR_CONFIG);
  const upstream = readConfig(UPSTREAM_CONFIG);
  assert.equal(ours.main, upstream.main);
  assert.equal(ours.compatibility_date, upstream.compatibility_date);
  assert.deepEqual(ours.compatibility_flags, upstream.compatibility_flags);
  assert.deepEqual(ours.durable_objects, upstream.durable_objects);
  assert.deepEqual(ours.migrations, upstream.migrations);
  assert.deepEqual(ours.observability, upstream.observability);
});
