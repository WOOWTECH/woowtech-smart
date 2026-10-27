import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "../config.js";
import { editPersistedConfig } from "../persisted-config.js";
import type { HubExecutionAgents } from "./daemon-executions.js";
import {
  HubRelationshipController,
  type HubRelationshipClock,
  type HubRelationshipRetryPolicy,
} from "./relationship-controller.js";
import type {
  HubEnrollment,
  HubEnrollmentResult,
  HubPermissionUpdate,
  HubRelationshipRemote,
  HubRevocation,
  HubSocketConnection,
  HubSocketCredentials,
} from "./relationship-remote.js";
import { HUB_DISABLED_MESSAGE, HubDisabledError } from "./woowtech-hub-gate.js";

// woowtech smart keeps Hub connections off unless config.json turns them on
// (daemon.hub.enabled). Upstream lets any owner session connect the daemon to a Hub at any URL,
// and the daemon then reconnects to that Hub on every start. WOOWTECH runs no Hub.
const HUB_ORIGIN = "https://hub.example.test";
const SOCKET_URL = "wss://hub.example.test/daemon";
const CONNECT = { hubUrl: HUB_ORIGIN, token: "enrollment-token", permissions: ["hub.execute"] };
const RELATIONSHIP_FILE = "hub-relationship.json";

const RELATIONSHIP = {
  daemonId: "daemon-stored",
  idempotencyKey: "enrollment-stored",
  hubOrigin: HUB_ORIGIN,
  createdAt: "2026-10-01T00:00:00.000Z",
  permissions: ["hub.execute"],
};
const STORED_ACTIVE = {
  version: 2,
  state: "active",
  relationship: RELATIONSHIP,
  credential: { secret: "stored-credential" },
  transport: { kind: "direct_websocket", webSocketUrl: SOCKET_URL },
};
const STORED_PENDING = {
  version: 2,
  state: "pending",
  relationship: RELATIONSHIP,
  credential: { secret: "stored-credential" },
  enrollment: { token: "stored-token" },
  identity: { serverId: "srv_hub_gate", daemonPublicKey: "hub-gate-public-key" },
};

/** A Hub that records what the daemon asks of it. */
class RecordingHub implements HubRelationshipRemote {
  readonly requests: string[] = [];

  async enroll(input: HubEnrollment): Promise<HubEnrollmentResult> {
    this.requests.push(`enroll ${input.hubOrigin}`);
    return { daemonId: input.daemonId, permissions: input.permissions, webSocketUrl: SOCKET_URL };
  }

  async updatePermissions(input: HubPermissionUpdate): Promise<{ permissions: string[] }> {
    this.requests.push(`update permissions ${input.hubOrigin}`);
    return { permissions: input.permissions };
  }

  async revoke(input: HubRevocation): Promise<void> {
    this.requests.push(`revoke ${input.hubOrigin}`);
  }

  openSocket(input: HubSocketCredentials): HubSocketConnection {
    this.requests.push(`open socket ${input.webSocketUrl}`);
    return { close: () => undefined };
  }
}

// Retries never fire: a test sees only what the daemon does right away.
const idleClock: HubRelationshipClock & HubRelationshipRetryPolicy = {
  now: () => new Date("2026-10-27T00:00:00.000Z"),
  schedule: () => ({ cancel: () => undefined }),
  delay: () => 1_000,
};

const unusedExecutionAgents: HubExecutionAgents = {
  create: async () => {
    throw new Error("Unexpected Hub agent create");
  },
  subscribe: () => () => undefined,
  invalidateAuthority: async () => undefined,
};

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function newHome(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "woowtech-hub-gate-"));
  homes.push(home);
  return home;
}

async function homeWithRelationship(record: unknown): Promise<string> {
  const home = await newHome();
  await writeFile(path.join(home, RELATIONSHIP_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return home;
}

/** The home's files and their contents, to show that nothing was written. */
async function filesIn(home: string): Promise<Record<string, string>> {
  const names = (await readdir(home)).sort();
  const contents = await Promise.all(names.map((name) => readFile(path.join(home, name), "utf8")));
  return Object.fromEntries(names.map((name, index) => [name, contents[index]]));
}

/** A logger that keeps the warnings it is given. */
function warningLogger(): { logger: pino.Logger; warnings: () => string[] } {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return {
    logger: pino({ level: "warn" }, destination),
    warnings: () =>
      lines
        .map((line) => JSON.parse(line) as { level: number; msg: string })
        .filter((entry) => entry.level === 40)
        .map((entry) => entry.msg),
  };
}

function controllerIn(
  paseoHome: string,
  hub: RecordingHub,
  logger: pino.Logger = pino({ level: "silent" }),
): HubRelationshipController {
  return new HubRelationshipController({
    paseoHome,
    hostname: "hub-gate.local",
    serverId: "srv_hub_gate",
    daemonPublicKey: "hub-gate-public-key",
    logger,
    remote: hub,
    clock: idleClock,
    retryPolicy: idleClock,
    createDaemonId: () => "daemon-hub-gate",
    attachSocket: async () => undefined,
    updateAttachedPermissions: () => undefined,
    createExecutionAgents: () => unusedExecutionAgents,
  });
}

/** Turns Hub connections on the way `woowtech-smart daemon config set daemon.hub.enabled true` does. */
function turnHubOn(home: string): void {
  editPersistedConfig(home, "daemon.hub.enabled", { value: true });
}

/** A home without config.json, or with the one the daemon writes when it first starts. */
async function homeWith(config: "no config.json" | "a new home's config.json"): Promise<string> {
  const home = await newHome();
  if (config === "a new home's config.json") loadConfig(home, { env: {} });
  return home;
}

describe("Hub connections in a new home", () => {
  test.each(["no config.json", "a new home's config.json"] as const)(
    "are off with %s: connecting fails before anything reaches the Hub or the disk",
    async (config) => {
      const home = await homeWith(config);
      const hub = new RecordingHub();
      const files = await filesIn(home);

      await expect(controllerIn(home, hub).connect(CONNECT)).rejects.toThrow(HubDisabledError);

      expect(hub.requests).toEqual([]);
      expect(await filesIn(home)).toEqual(files);
    },
  );

  test("the error has its own code, and it and the status name the key that turns them on", async () => {
    const controller = controllerIn(await newHome(), new RecordingHub());

    await expect(controller.connect(CONNECT)).rejects.toMatchObject({
      name: "HubDisabledError",
      code: "hub_disabled",
      message: HUB_DISABLED_MESSAGE,
    });
    expect(HUB_DISABLED_MESSAGE).toContain(
      "woowtech-smart daemon config set daemon.hub.enabled true",
    );
    expect(controller.status()).toEqual({
      state: "not_connected",
      daemonId: null,
      hubOrigin: null,
      permissions: [],
      connectedAt: null,
      lastError: HUB_DISABLED_MESSAGE,
    });
  });

  // Anything but true keeps them off, also a config.json the daemon cannot read.
  test.each([
    JSON.stringify({ version: 1, daemon: { hub: { enabled: false } } }),
    JSON.stringify({ version: 1, daemon: { hub: {} } }),
    JSON.stringify({ version: 1, daemon: { hub: { enabled: "true" } } }),
    "not json",
  ])("stay off with config.json %s", async (configText) => {
    const home = await newHome();
    await writeFile(path.join(home, "config.json"), configText);
    const hub = new RecordingHub();

    await expect(controllerIn(home, hub).connect(CONNECT)).rejects.toThrow(HubDisabledError);
    expect(hub.requests).toEqual([]);
  });
});

describe("Hub connections turned on with daemon config set", () => {
  test("take only a boolean", async () => {
    const home = await newHome();

    expect(() => editPersistedConfig(home, "daemon.hub.enabled", { value: "true" })).toThrow();
    turnHubOn(home);

    const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
    expect(written.daemon.hub).toEqual({ enabled: true });
  });

  test("connect as upstream's do: the daemon enrolls, stores the relationship and dials the Hub", async () => {
    const home = await newHome();
    turnHubOn(home);
    const hub = new RecordingHub();

    const status = await controllerIn(home, hub).connect(CONNECT);

    expect(hub.requests).toEqual([`enroll ${HUB_ORIGIN}`, `open socket ${SOCKET_URL}`]);
    expect(status).toEqual({
      state: "connecting",
      daemonId: "daemon-hub-gate",
      hubOrigin: HUB_ORIGIN,
      permissions: ["hub.execute"],
      connectedAt: null,
      lastError: null,
    });
    const stored = JSON.parse(await readFile(path.join(home, RELATIONSHIP_FILE), "utf8"));
    expect(stored).toMatchObject({ state: "active", transport: { webSocketUrl: SOCKET_URL } });
  });
});

describe("a Hub relationship stored in hub-relationship.json", () => {
  test.each([
    ["an active", STORED_ACTIVE],
    ["a pending", STORED_PENDING],
  ])(
    "%s one is not resumed at startup while Hub connections are off, and one warning names the key",
    async (_kind, record) => {
      const home = await homeWithRelationship(record);
      const files = await filesIn(home);
      const hub = new RecordingHub();
      const { logger, warnings } = warningLogger();
      const controller = controllerIn(home, hub, logger);

      await controller.start();

      expect(hub.requests).toEqual([]);
      expect(await filesIn(home)).toEqual(files);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain("daemon.hub.enabled");
      expect(controller.status()).toEqual({
        state: "not_connected",
        daemonId: "daemon-stored",
        hubOrigin: HUB_ORIGIN,
        permissions: ["hub.execute"],
        connectedAt: null,
        lastError: HUB_DISABLED_MESSAGE,
      });
    },
  );

  test("stays as it is while Hub connections are off: connecting again and permission changes fail", async () => {
    const pendingHome = await homeWithRelationship(STORED_PENDING);
    const activeHome = await homeWithRelationship(STORED_ACTIVE);
    const pendingFiles = await filesIn(pendingHome);
    const activeFiles = await filesIn(activeHome);
    const hub = new RecordingHub();

    await expect(controllerIn(pendingHome, hub).connect(CONNECT)).rejects.toThrow(HubDisabledError);
    await expect(
      controllerIn(activeHome, hub).updatePermissions({ grant: ["daemon.manage"], revoke: [] }),
    ).rejects.toThrow(HubDisabledError);

    expect(hub.requests).toEqual([]);
    expect(await filesIn(pendingHome)).toEqual(pendingFiles);
    expect(await filesIn(activeHome)).toEqual(activeFiles);
  });

  // Disconnecting only takes access away, so it works as upstream's does while Hub connections
  // are off: with --force the daemon only removes its file, without it also asks the Hub to
  // revoke the relationship.
  test("can still be removed with --force while Hub connections are off", async () => {
    const home = await homeWithRelationship(STORED_ACTIVE);
    const hub = new RecordingHub();

    const { status } = await controllerIn(home, hub).disconnect({ force: true });

    expect(hub.requests).toEqual([]);
    expect(await readdir(home)).toEqual([]);
    expect(status).toMatchObject({ state: "not_connected", daemonId: null, hubOrigin: null });
  });

  test("can still be removed without --force while Hub connections are off, revoking it at the Hub", async () => {
    const home = await homeWithRelationship(STORED_ACTIVE);
    const hub = new RecordingHub();

    const { status } = await controllerIn(home, hub).disconnect({ force: false });

    expect(hub.requests).toEqual([`revoke ${HUB_ORIGIN}`]);
    expect(await readdir(home)).toEqual([]);
    expect(status).toMatchObject({ state: "not_connected", daemonId: null, hubOrigin: null });
  });

  test("is resumed at startup once Hub connections are on", async () => {
    const home = await homeWithRelationship(STORED_ACTIVE);
    turnHubOn(home);
    const hub = new RecordingHub();
    const { logger, warnings } = warningLogger();
    const controller = controllerIn(home, hub, logger);

    await controller.start();

    expect(hub.requests).toEqual([`open socket ${SOCKET_URL}`]);
    expect(warnings()).toEqual([]);
    expect(controller.status()).toMatchObject({ state: "connecting", lastError: null });
  });
});
