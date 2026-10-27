// woowtech smart keeps Hub connections off unless config.json turns them on: daemon.hub.enabled,
// false unless set (packages/server/src/server/hub/woowtech-hub-gate.ts). Upstream lets any owner
// session (the CLI, a paired app, the hosted web app talking to the daemon directly, or plugin
// code running in that web app's origin) connect the daemon to a Hub at any URL, and the daemon
// then reconnects to that Hub on every start: one request leaves a lasting remote-control
// channel. WOOWTECH runs no Hub. A merge can flip the default, drop the gate's hooks in
// relationship-controller.ts, manage Hub relationships somewhere else, or let an RPC change the
// switch. These checks run the controller and the config code from source through tsx against
// a Hub that records what it is asked, and read the hooks from the sources. The server's imports
// from other packages read their dist, so build them first: npm run build:server.
//
//   node --test woowtech/hub-gate.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { findInShippedSources, repoRoot } from "./shipped-sources.mjs";
import { importSource } from "./source-modules.mjs";

const { loadConfig } = await importSource("packages/server/src/server/config.ts");
const { editPersistedConfig, readPersistedConfig } = await importSource(
  "packages/server/src/server/persisted-config.ts",
);
const { HubRelationshipController } = await importSource(
  "packages/server/src/server/hub/relationship-controller.ts",
);
const { hubEnabledInConfig } = await importSource(
  "packages/server/src/server/hub/woowtech-hub-gate.ts",
);

const CONTROLLER_SOURCE = "packages/server/src/server/hub/relationship-controller.ts";
const GATE_SOURCE = "packages/server/src/server/hub/woowtech-hub-gate.ts";
const HUB_ORIGIN = "https://hub.example.test";
const SOCKET_URL = "wss://hub.example.test/daemon";
const CONNECT = { hubUrl: HUB_ORIGIN, token: "enrollment-token", permissions: ["hub.execute"] };
const STORED_ACTIVE = {
  version: 2,
  state: "active",
  relationship: {
    daemonId: "daemon-stored",
    idempotencyKey: "enrollment-stored",
    hubOrigin: HUB_ORIGIN,
    createdAt: "2026-10-01T00:00:00.000Z",
    permissions: ["hub.execute"],
  },
  credential: { secret: "stored-credential" },
  transport: { kind: "direct_websocket", webSocketUrl: SOCKET_URL },
};

const homes = [];
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function daemonHome() {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-hub-gate-"));
  homes.push(home);
  return home;
}

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const relationshipFile = (home) => path.join(home, "hub-relationship.json");

/** A Hub that records what the daemon asks of it. */
function recordingHub() {
  const requests = [];
  return {
    requests,
    async enroll(input) {
      requests.push(`enroll ${input.hubOrigin}`);
      return { daemonId: input.daemonId, permissions: input.permissions, webSocketUrl: SOCKET_URL };
    },
    async updatePermissions(input) {
      requests.push(`update permissions ${input.hubOrigin}`);
      return { permissions: input.permissions };
    },
    async revoke(input) {
      requests.push(`revoke ${input.hubOrigin}`);
    },
    openSocket(input) {
      requests.push(`open socket ${input.webSocketUrl}`);
      return { close() {} };
    },
  };
}

const quietLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => quietLogger };

/** The daemon's Hub controller for `home`, as bootstrap.ts builds it, talking to `hub`. */
function controllerIn(home, hub) {
  return new HubRelationshipController({
    paseoHome: home,
    hostname: "hub-gate.local",
    serverId: "srv_hub_gate",
    daemonPublicKey: "hub-gate-public-key",
    logger: quietLogger,
    remote: hub,
    // Retries never fire: the checks see only what the daemon does right away.
    clock: { now: () => new Date(), schedule: () => ({ cancel() {} }) },
    retryPolicy: { delay: () => 1_000 },
    createDaemonId: () => "daemon-hub-gate",
    attachSocket: async () => {},
    updateAttachedPermissions: () => {},
    createExecutionAgents: () => ({
      create: async () => {
        throw new Error("unexpected Hub agent");
      },
      subscribe: () => () => {},
      invalidateAuthority: async () => {},
    }),
  });
}

test("a new home keeps Hub connections off: connecting fails before the Hub or the disk is touched", async () => {
  const home = daemonHome();
  loadConfig(home, { env: {} }); // the config.json the daemon writes for a new home
  assert.equal(hubEnabledInConfig(readPersistedConfig(home)), false, "a new home's config.json");
  const cliDefaults = readPersistedConfig(daemonHome(), { defaultsIfMissing: true });
  assert.equal(hubEnabledInConfig(cliDefaults), false, "the CLI's defaults");

  const hub = recordingHub();
  await assert.rejects(controllerIn(home, hub).connect(CONNECT), (error) => {
    assert.equal(error.code, "hub_disabled");
    assert.match(error.message, /daemon config set daemon\.hub\.enabled true/);
    return true;
  });
  assert.deepEqual(hub.requests, [], "requests that reached the Hub");
  assert.equal(existsSync(relationshipFile(home)), false, "hub-relationship.json was written");
});

test("daemon config set daemon.hub.enabled true lets the daemon connect as upstream's does", async () => {
  const home = daemonHome();
  editPersistedConfig(home, "daemon.hub.enabled", { value: true });
  const hub = recordingHub();

  await controllerIn(home, hub).connect(CONNECT);

  assert.deepEqual(hub.requests, [`enroll ${HUB_ORIGIN}`, `open socket ${SOCKET_URL}`]);
  assert.equal(JSON.parse(readFileSync(relationshipFile(home), "utf8")).state, "active");
});

test("a stored Hub relationship is neither resumed nor changed while Hub connections are off", async () => {
  const home = daemonHome();
  const stored = `${JSON.stringify(STORED_ACTIVE, null, 2)}\n`;
  writeFileSync(relationshipFile(home), stored);
  const hub = recordingHub();
  const controller = controllerIn(home, hub);

  await controller.start();
  await assert.rejects(
    controller.updatePermissions({ grant: ["daemon.manage"], revoke: [] }),
    (error) => error.code === "hub_disabled",
  );

  assert.deepEqual(hub.requests, [], "requests that reached the Hub");
  assert.equal(readFileSync(relationshipFile(home), "utf8"), stored);
  const status = controller.status();
  assert.equal(status.state, "not_connected");
  assert.match(status.lastError, /daemon\.hub\.enabled/);
});

test("the gate's hooks stay first in the Hub controller", () => {
  const controller = read(CONTROLLER_SOURCE);
  const hooks = [
    [/^ {4}this\.hubGate = new WoowtechHubGate\(options\);$/m, "the constructor makes the gate"],
    [
      /async start\(\): Promise<void> \{\n\s*if \(!this\.hubGate\.allowsStart\(this\.record\)\) return;/,
      "start() asks the gate first",
    ],
    [
      /async connect\(input: \{[^}]*\}\): Promise<HubRelationshipStatus> \{\n\s*this\.hubGate\.assertEnabled\(\);/,
      "connect() asks the gate first",
    ],
    [
      /async updatePermissions\(input: \{[^}]*\}\): Promise<HubRelationshipStatus> \{\n\s*this\.hubGate\.assertEnabled\(\);/,
      "updatePermissions() asks the gate first",
    ],
    [
      /status\(\): HubRelationshipStatus \{\n\s*return this\.hubGate\.status\(\{/,
      "status() reports through the gate",
    ],
  ];
  for (const [hook, what] of hooks) assert.match(controller, hook, `${CONTROLLER_SOURCE}: ${what}`);
});

// The daemon manages Hub relationships through one HubRelationshipController, which bootstrap.ts
// builds and session.ts reaches through the daemon session. A new Hub management request, or a
// second implementation, could connect a Hub past the gate.
test("the gated controller is the daemon's only way to manage Hub relationships", () => {
  assert.deepEqual(
    findInShippedSources([/\bnew HubRelationshipController\(/], {
      dirs: ["packages/server/src"],
    }).map((hit) => hit.split(":")[0]),
    ["packages/server/src/server/bootstrap.ts"],
  );
  assert.deepEqual(
    findInShippedSources([/\bimplements HubRelationshipManagement\b/], {
      dirs: ["packages/server/src"],
    }).map((hit) => hit.split(":")[0]),
    [CONTROLLER_SOURCE],
  );
  const managementRequests = read(
    "packages/server/src/server/authorization/operation-permissions.ts",
  ).match(/"hub\.management\.[\w.]+\.request"/g);
  assert.deepEqual(managementRequests, [
    '"hub.management.daemon.connect.request"',
    '"hub.management.daemon.disconnect.request"',
    '"hub.management.daemon.get_status.request"',
    '"hub.management.daemon.permissions.update.request"',
  ]);
});

// The switch lives in config.json only, where `daemon config get` shows it. An RPC that could set
// it would let the session asking for a Hub connection switch Hub connections on first, and an
// environment variable would be a second switch that config.json does not show.
test("no RPC and no environment variable turns Hub connections on", () => {
  const store = read("packages/server/src/server/daemon-config-store.ts");
  const pick = /function pickSupportedPatchFields\([\s\S]*?^\}$/m.exec(store)?.[0];
  assert.ok(pick, "pickSupportedPatchFields is gone from daemon-config-store.ts");
  assert.doesNotMatch(pick, /\bhub\b/, "a daemon config patch can set the Hub switch");

  const messages = read("packages/protocol/src/messages.ts");
  for (const schema of ["MutableDaemonConfigSchema", "MutableDaemonConfigPatchSchema"]) {
    const body = new RegExp(`export const ${schema} = z[\\s\\S]*?^ {2}\\}\\)`, "m").exec(
      messages,
    )?.[0];
    assert.ok(body, `${schema} is gone from messages.ts`);
    assert.doesNotMatch(body, /^\s*hub\??:/m, `${schema} has a Hub switch`);
  }

  assert.deepEqual(
    findInShippedSources([/PASEO_HUB_ENABLED|\bhub\??\.enabled\b/], {
      skipPaths: [GATE_SOURCE],
      skipComments: true,
    }),
    [],
    "only woowtech-hub-gate.ts reads or names the Hub switch",
  );
});
