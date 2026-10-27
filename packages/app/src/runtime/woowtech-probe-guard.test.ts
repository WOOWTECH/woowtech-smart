import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "@getpaseo/client/internal/daemon-client";
import {
  HostRuntimeStore,
  type HostRuntimeControllerDeps,
  type HostRuntimeStorage,
} from "./host-runtime";
import { HostConfirmationDeclinedError, hostConfirmations } from "./woowtech-host-confirmations";

// A probe learns a daemon's id from the daemon itself. Saved by that id, a direct connection to
// anything that claims a saved host's id would join that host and be used for it
// (upsertHostConnectionInProfiles merges by id; syncHosts activates the new connection).
// These tests run the real host store; woowtech-host-confirmations.test.ts runs the questions.

const REGISTRY_KEY = "@paseo:daemon-registry";

const SAVED_RELAY_HOST = {
  serverId: "srv_A",
  label: "Studio Mac",
  connections: [
    {
      id: "relay:wss:relay.woowtech.io:443",
      type: "relay",
      relayEndpoint: "relay.woowtech.io:443",
      useTls: true,
      daemonPublicKeyB64: Buffer.alloc(32, 8).toString("base64"),
    },
  ],
  preferredConnectionId: "relay:wss:relay.woowtech.io:443",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

class MemoryStorage implements HostRuntimeStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  async removeItem(key: string) {
    this.values.delete(key);
  }
}

// A transport that never connects: no daemon answers the saved host in these tests.
class SilentTransport implements DaemonTransport {
  send(): void {}
  close(): void {}
  onMessage() {
    return () => {};
  }
  onOpen() {
    return () => {};
  }
  onClose() {
    return () => {};
  }
  onError() {
    return () => {};
  }
}

class ProbeClient extends DaemonClient {
  closes = 0;
  override async close(): Promise<void> {
    this.closes += 1;
    await super.close();
  }
}

function silentClient(): ProbeClient {
  return new ProbeClient({
    url: "ws://unused.test",
    clientId: "probe-guard",
    transportFactory: () => new SilentTransport(),
    reconnect: { enabled: false },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

const stores: HostRuntimeStore[] = [];
const clients: ProbeClient[] = [];

/**
 * A store over in-memory storage whose only daemon is "lan:6770", which says it is srv_A (or the
 * ids of `daemons`, by address).
 */
function storeWith(options: {
  savedHosts: unknown[];
  endBootAfterLoad: boolean;
  daemons?: Record<string, string>;
  Store?: typeof HostRuntimeStore;
}) {
  const daemons = options.daemons ?? { "lan:6770": "srv_A" };
  const storage = new MemoryStorage();
  storage.values.set(REGISTRY_KEY, JSON.stringify(options.savedHosts));
  if (options.endBootAfterLoad) storage.values.set("@paseo:e2e", "1");
  const probedEndpoints: string[] = [];
  const probeClients: ProbeClient[] = [];
  const deps: HostRuntimeControllerDeps = {
    createClient: () => {
      const client = silentClient();
      clients.push(client);
      return client;
    },
    connectToDaemon: async ({ host, connection }) => {
      if (host.serverId !== "" || connection.type !== "directTcp") {
        throw new Error("offline");
      }
      probedEndpoints.push(connection.endpoint);
      const serverId = daemons[connection.endpoint];
      if (serverId === undefined) throw new Error("nothing listens there");
      const client = silentClient();
      clients.push(client);
      probeClients.push(client);
      return { client, serverId, hostname: "lan box" };
    },
    getClientId: async () => "cid_probe_guard",
    readInitialConnectionHint: () => null,
  };
  const Store = options.Store ?? HostRuntimeStore;
  const store = new Store({ deps, storage });
  stores.push(store);
  return {
    store,
    probedEndpoints,
    probeClients,
    registry: () =>
      JSON.stringify(store.getHosts().map((host) => [host.serverId, host.connections])),
    saved: () => storage.values.get(REGISTRY_KEY),
  };
}

beforeEach(() => {
  hostConfirmations.resetForTests();
});

afterEach(async () => {
  hostConfirmations.resetForTests();
  vi.unstubAllGlobals();
  delete process.env.EXPO_PUBLIC_LOCAL_DAEMON;
  for (const store of stores.splice(0)) store.syncHosts([]);
  for (const client of clients.splice(0)) await client.close();
});

describe("a direct connection that reports a saved host's id", () => {
  it("is asked about before it joins the host, and refused, changes nothing", async () => {
    const f = storeWith({ savedHosts: [SAVED_RELAY_HOST], endBootAfterLoad: true });
    await f.store.boot();
    const before = { registry: f.registry(), saved: f.saved() };
    const activeBefore = f.store.getSnapshot("srv_A")?.activeConnectionId ?? null;

    const probing = f.store.probeAndUpsertDirectConnection({ endpoint: "lan:6770" });
    await vi.waitFor(() =>
      expect(hostConfirmations.getPending()).toMatchObject({
        kind: "directConnectionToSavedHost",
        serverId: "srv_A",
        savedLabel: "Studio Mac",
        endpoint: "lan:6770",
      }),
    );
    expect({ registry: f.registry(), saved: f.saved() }).toEqual(before);
    expect(f.store.getSnapshot("srv_A")?.activeConnectionId ?? null).toBe(activeBefore);
    expect(f.probeClients[0]?.closes).toBe(0);

    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, false);
    await expect(probing).rejects.toBeInstanceOf(HostConfirmationDeclinedError);
    expect(f.probeClients[0]?.closes).toBe(1);
    expect({ registry: f.registry(), saved: f.saved() }).toEqual(before);

    // What the user starts is asked about every time, whatever the last answer was.
    const again = f.store.probeAndUpsertDirectConnection({ endpoint: "lan:6770" });
    await vi.waitFor(() =>
      expect(hostConfirmations.getPending()).toMatchObject({
        kind: "directConnectionToSavedHost",
        serverId: "srv_A",
      }),
    );
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, false);
    await expect(again).rejects.toBeInstanceOf(HostConfirmationDeclinedError);
    expect(f.probeClients[1]?.closes).toBe(1);
    expect({ registry: f.registry(), saved: f.saved() }).toEqual(before);
  });

  it("joins the saved host once the user says yes", async () => {
    const f = storeWith({ savedHosts: [SAVED_RELAY_HOST], endBootAfterLoad: true });
    await f.store.boot();

    const probing = f.store.probeAndUpsertDirectConnection({ endpoint: "lan:6770" });
    await vi.waitFor(() => expect(hostConfirmations.getPending()).not.toBeNull());
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, true);
    const result = await probing;

    expect(result.serverId).toBe("srv_A");
    expect(f.store.getHosts().map((host) => [host.serverId, host.label])).toEqual([
      ["srv_A", "Studio Mac"],
    ]);
    expect(f.store.getHosts()[0]?.connections.map((connection) => connection.id)).toEqual([
      "relay:wss:relay.woowtech.io:443",
      "direct:lan:6770",
    ]);
  });
});

describe("a connection a saved host has, now reporting another id", () => {
  it("is asked about before the saved host takes the new id, and nothing changes on a no", async () => {
    const lanHost = {
      ...SAVED_RELAY_HOST,
      connections: [{ id: "direct:lan:6770", type: "directTcp", endpoint: "lan:6770" }],
      preferredConnectionId: "direct:lan:6770",
    };
    const f = storeWith({
      savedHosts: [lanHost],
      endBootAfterLoad: true,
      daemons: { "lan:6770": "srv_B" },
    });
    await f.store.boot();
    const before = { registry: f.registry(), saved: f.saved() };

    const probing = f.store.probeAndUpsertDirectConnection({ endpoint: "lan:6770" });
    await vi.waitFor(() =>
      expect(hostConfirmations.getPending()).toMatchObject({
        kind: "hostIdChanged",
        serverId: "srv_B",
        savedServerId: "srv_A",
        savedLabel: "Studio Mac",
      }),
    );
    expect({ registry: f.registry(), saved: f.saved() }).toEqual(before);

    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, false);
    await expect(probing).rejects.toBeInstanceOf(HostConfirmationDeclinedError);
    expect(f.probeClients[0]?.closes).toBe(1);
    expect({ registry: f.registry(), saved: f.saved() }).toEqual(before);
  });
});

describe("the configured daemon (EXPO_PUBLIC_LOCAL_DAEMON)", () => {
  it("is asked about once, though the app retries it every second", async () => {
    process.env.EXPO_PUBLIC_LOCAL_DAEMON = "lan:6770";
    const f = storeWith({ savedHosts: [SAVED_RELAY_HOST], endBootAfterLoad: false });
    await f.store.boot();
    await vi.waitFor(() =>
      expect(hostConfirmations.getPending()).toMatchObject({ kind: "directConnectionToSavedHost" }),
    );
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, false);

    await vi.waitFor(() => expect(f.probedEndpoints.length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(f.probeClients[1]?.closes).toBe(1));
    expect(hostConfirmations.getPending()).toBeNull();

    // A yes to what the user starts gives the host the connection, which ends the retrying.
    const manual = f.store.probeAndUpsertDirectConnection({ endpoint: "lan:6770" });
    await vi.waitFor(() => expect(hostConfirmations.getPending()).not.toBeNull());
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, true);
    await manual;
    // The loop sees the connection at its next turn and stops; it must not outlive this test.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });

  it("is not probed from a public https page, as the boot probe of localhost is not", async () => {
    process.env.EXPO_PUBLIC_LOCAL_DAEMON = "lan:6770";
    vi.stubGlobal("window", { location: { protocol: "https:", hostname: "web.example.test" } });
    const f = storeWith({ savedHosts: [], endBootAfterLoad: false });

    await f.store.boot();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(f.probedEndpoints).toEqual([]);
    expect(f.store.getHosts()).toEqual([]);
  });
});

describe("on a phone", () => {
  afterEach(() => {
    vi.doUnmock("@/constants/platform");
    vi.resetModules();
  });

  // React Native sets window to its global object, and a release build gives it no location. The
  // phone is not a browser: a new direct host is added without a question, as upstream does.
  it("adds a new direct host without asking, though window has no location", async () => {
    vi.resetModules();
    vi.doMock("@/constants/platform", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants/platform")>()),
      isWeb: false,
      isNative: true,
    }));
    const phone = await import("./host-runtime");
    const phoneConfirmations = await import("./woowtech-host-confirmations");
    // After the imports: react-native-reanimated reads window.matchMedia when it loads.
    vi.stubGlobal("window", {});
    const f = storeWith({
      savedHosts: [],
      endBootAfterLoad: true,
      daemons: { "192.168.1.20:6770": "srv_new" },
      Store: phone.HostRuntimeStore,
    });
    await f.store.boot();

    const result = await f.store.probeAndUpsertDirectConnection({ endpoint: "192.168.1.20:6770" });

    expect(result.serverId).toBe("srv_new");
    expect(f.store.getHosts().map((host) => host.serverId)).toEqual(["srv_new"]);
    expect(phoneConfirmations.hostConfirmations.getPending()).toBeNull();
    expect(f.probeClients[0]?.closes).toBe(0);
  });
});

describe("probing localhost at boot", () => {
  it("does not probe from a public https page", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:", hostname: "web.example.test" } });
    const f = storeWith({ savedHosts: [], endBootAfterLoad: false });

    await f.store.boot();

    expect(f.probedEndpoints).toEqual([]);
  });

  it("probes where upstream does, such as without a window", async () => {
    const f = storeWith({ savedHosts: [], endBootAfterLoad: false });

    await f.store.boot();

    expect(f.probedEndpoints).toEqual(["localhost:6770"]);
  });
});
