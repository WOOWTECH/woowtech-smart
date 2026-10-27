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

/** A store over in-memory storage whose only daemon is "lan:6770", which says it is srv_A. */
function storeWith(options: { savedHosts: unknown[]; endBootAfterLoad: boolean }) {
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
      if (connection.endpoint !== "lan:6770") throw new Error("nothing listens there");
      const client = silentClient();
      clients.push(client);
      probeClients.push(client);
      return { client, serverId: "srv_A", hostname: "lan box" };
    },
    getClientId: async () => "cid_probe_guard",
    readInitialConnectionHint: () => null,
  };
  const store = new HostRuntimeStore({ deps, storage });
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

    // Refused once in this run: refused again without asking.
    await expect(
      f.store.probeAndUpsertDirectConnection({ endpoint: "lan:6770" }),
    ).rejects.toBeInstanceOf(HostConfirmationDeclinedError);
    expect(hostConfirmations.getPending()).toBeNull();
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
