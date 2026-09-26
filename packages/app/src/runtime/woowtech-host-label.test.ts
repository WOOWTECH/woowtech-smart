import { afterEach, describe, expect, it } from "vitest";
import {
  DaemonClient,
  type DaemonEventHandler,
  type DaemonTransport,
} from "@getpaseo/client/internal/daemon-client";
import {
  HostRuntimeStore,
  type HostRuntimeStorage,
  type HostRuntimeControllerDeps,
} from "./host-runtime";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { handlePairingLink } from "./woowtech-pairing-link";
import { StoredHostRegistrySchema, type HostProfile } from "@/types/host-connection";
import type { ReplicaRowStore } from "./replica-cache/row-store";

const REGISTRY_KEY = "@paseo:daemon-registry";
const SERVER_ID = "srv_label_test";

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void = () => {};
  reject: (error: Error) => void = () => {};
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class MemoryRegistry implements HostRuntimeStorage {
  readonly values = new Map<string, string>([["@paseo:e2e", "1"]]);
  readonly writes: string[] = [];
  loadGate: Promise<void> | null = null;
  async getItem(key: string) {
    if (key === REGISTRY_KEY && this.loadGate) await this.loadGate;
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.values.set(key, value);
    if (key === REGISTRY_KEY) this.writes.push(value);
  }
  async removeItem(key: string) {
    this.values.delete(key);
  }
  saved() {
    return StoredHostRegistrySchema.parse(JSON.parse(this.values.get(REGISTRY_KEY) ?? "[]"));
  }
}

// No directory demand in this suite; storage still has an explicit adapter.
const emptyRows: ReplicaRowStore = {
  open: async () => {},
  read: async () => [],
  readAll: async () => [],
  apply: async () => {},
  deleteHost: async () => {},
  renameHost: async () => {},
  clear: async () => {},
};

class HostInfoTransport implements DaemonTransport {
  private receive: (data: unknown, isBinary: boolean) => void = () => {};
  private opened: () => void = () => {};
  private disconnected: (event?: unknown) => void = () => {};
  readonly ready = new Deferred<void>();
  send(data: string | Uint8Array | ArrayBuffer): void {
    if (typeof data !== "string") return;
    const frame: unknown = JSON.parse(data);
    if (typeof frame === "object" && frame !== null && "type" in frame && frame.type === "ping") {
      this.receive(JSON.stringify({ type: "pong" }), false);
    }
  }
  close(): void {}
  onMessage(handler: (data: unknown, isBinary: boolean) => void) {
    this.receive = handler;
    return () => {
      this.receive = () => {};
    };
  }
  onOpen(handler: () => void) {
    this.opened = handler;
    this.ready.resolve();
    return () => {};
  }
  onClose(handler: (event?: unknown) => void) {
    this.disconnected = handler;
    return () => {};
  }
  disconnect() {
    this.disconnected({ code: 1006, reason: "offline" });
  }
  onError(_handler: (event?: unknown) => void) {
    return () => {};
  }
  serverInfo(hostname: string | null, serverId = SERVER_ID): void {
    this.receive(
      JSON.stringify({
        type: "session",
        message: {
          type: "status",
          payload: {
            status: "server_info",
            serverId,
            hostname,
            version: "0.8.0",
            features: { ownedSubscriptions: true },
          },
        },
      }),
      false,
    );
  }
  open(hostname: string | null, serverId = SERVER_ID): void {
    this.opened();
    this.serverInfo(hostname, serverId);
  }
}

class CapturingClient extends DaemonClient {
  readonly statusCallbacks: Array<(message: SessionOutboundMessage) => void> = [];
  closeGate: Promise<void> | null = null;
  readonly closing = new Deferred<void>();
  override async close(): Promise<void> {
    this.closing.resolve();
    if (this.closeGate) await this.closeGate;
    await super.close();
  }
  override on<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void;
  override on(handler: DaemonEventHandler): () => void;
  override on(
    arg1: SessionOutboundMessage["type"] | DaemonEventHandler,
    arg2?: (message: SessionOutboundMessage) => void,
  ): () => void {
    if (typeof arg1 === "function") return super.on(arg1);
    if (!arg2) throw new Error("missing event handler");
    if (arg1 === "status") this.statusCallbacks.push(arg2);
    return super.on(arg1, arg2);
  }
}

const stores: HostRuntimeStore[] = [];
const clients: DaemonClient[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.syncHosts([]);
  for (const client of clients.splice(0)) await client.close();
});

function fixture(storage = new MemoryRegistry()) {
  const transport = new HostInfoTransport();
  const client = new CapturingClient({
    url: "ws://unused.test",
    clientId: "test-host-label",
    transportFactory: () => transport,
    reconnect: { enabled: false },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  clients.push(client);
  let probes = 0;
  const gate = new Deferred<void>();
  let replacement: DaemonClient = client;
  const deps: HostRuntimeControllerDeps = {
    createClient: () => replacement,
    connectToDaemon: async ({ host }) => {
      if (host.serverId !== SERVER_ID) throw new Error("saved host is offline");
      probes += 1;
      await gate.promise;
      await client.connect();
      return {
        client,
        serverId: SERVER_ID,
        hostname: client.getLastServerInfoMessage()?.hostname ?? null,
      };
    },
    getClientId: async () => "test-client",
  };
  const store = new HostRuntimeStore({
    storage,
    deps,
    replicaRowStore: emptyRows,
    revokePushNotifications: async () => {},
  });
  stores.push(store);
  return {
    store,
    client,
    transport,
    storage,
    gate,
    probes: () => probes,
    replaceClient: (next: DaemonClient) => {
      replacement = next;
    },
  };
}

async function importHost(store: HostRuntimeStore): Promise<HostProfile> {
  return store.upsertConnectionFromOffer({
    v: 2,
    serverId: SERVER_ID,
    daemonPublicKeyB64: "synthetic-public-key",
    relay: { endpoint: "relay.invalid:443", useTls: true },
  });
}

async function online(f: ReturnType<typeof fixture>, hostname: string | null): Promise<void> {
  const ready = new Promise<void>((resolve) => {
    const unsubscribe = f.store.subscribe(SERVER_ID, () => {
      if (f.store.getSnapshot(SERVER_ID)?.connectionStatus !== "online") return;
      unsubscribe();
      resolve();
    });
  });
  f.gate.resolve();
  await f.transport.ready.promise;
  f.transport.open(hostname);
  await ready;
}

describe("woowtech host label at the real store/controller boundary", () => {
  it("fills a pairing fallback label from the normal server_info and saves it without another probe", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    expect(f.store.getHosts().map((host) => host.label)).toEqual([SERVER_ID]);
    await online(f, "  Studio Mac  ");
    expect(f.store.getHosts().map((host) => host.label)).toEqual(["Studio Mac"]);
    expect(f.storage.saved().map((host) => host.label)).toEqual(["Studio Mac"]);
    expect(f.probes()).toBe(1);
    const restored = fixture(f.storage);
    await restored.store.boot();
    expect(restored.store.getHosts().map((host) => host.label)).toEqual(["Studio Mac"]);
  });

  it("does not replace a name changed while the normal connection is pending", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    await f.store.renameHost(SERVER_ID, "User's Mac");
    await online(f, "Daemon Mac");
    expect(f.store.getHosts().map((host) => host.label)).toEqual(["User's Mac"]);
    expect(f.storage.saved().map((host) => host.label)).toEqual(["User's Mac"]);
    expect(f.probes()).toBe(1);
  });

  it("does not resurrect a host removed while its connection is pending", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    await f.store.removeHost(SERVER_ID);
    const stopped = new Promise<void>((resolve) => {
      const unsubscribe = f.client.subscribeConnectionStatus((state) => {
        if (state.status !== "disposed") return;
        unsubscribe();
        resolve();
      });
    });
    f.gate.resolve();
    await f.transport.ready.promise;
    f.transport.open("Late Mac");
    await stopped;
    expect(f.store.getHosts()).toEqual([]);
    expect(f.storage.saved()).toEqual([]);
  });

  it("ignores unrelated server identity and empty hostname, then fills a later server_info once", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    await online(f, null);
    const writes = f.storage.writes.length;
    f.transport.serverInfo("Wrong Mac", "srv_someone_else");
    f.transport.serverInfo("   ");
    expect(f.store.getHosts().map((host) => host.label)).toEqual([SERVER_ID]);
    expect(f.storage.writes.length).toBe(writes);
    f.transport.serverInfo("Late Mac");
    f.transport.serverInfo("Other Mac");
    expect(f.store.getHosts().map((host) => host.label)).toEqual(["Late Mac"]);
    expect(f.storage.saved().map((host) => host.label)).toEqual(["Late Mac"]);
    expect(f.storage.writes.length).toBe(writes + 1);
    expect(f.probes()).toBe(1);
  });

  it("fills an empty label but leaves a hostname-derived or renamed label unchanged", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    await f.store.renameHost(SERVER_ID, "   ");
    await online(f, "Trimmed Mac");
    expect(f.store.getHosts().map((host) => host.label)).toEqual(["Trimmed Mac"]);
    await f.store.renameHost(SERVER_ID, "My name");
    f.transport.serverInfo("Changed daemon name");
    expect(f.storage.saved().map((host) => host.label)).toEqual(["My name"]);
  });

  it("preserves an offline import and fills its saved fallback after the next boot connects", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    f.gate.reject(new Error("host offline"));
    await f.store.runProbeCycleNow(SERVER_ID);
    expect(f.storage.saved().map((host) => host.label)).toEqual([SERVER_ID]);
    expect(f.probes()).toBe(1);
    const restored = fixture(f.storage);
    await restored.store.boot();
    await online(restored, "Back online Mac");
    expect(restored.store.getHosts().map((host) => host.label)).toEqual(["Back online Mac"]);
    expect(restored.storage.saved().map((host) => host.label)).toEqual(["Back online Mac"]);
    expect(restored.probes()).toBe(1);
  });

  it("uses a reconnect's normal server_info without a naming probe", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    await online(f, null);
    f.client.setReconnectEnabled(false);
    f.transport.disconnect();
    expect(f.store.getSnapshot(SERVER_ID)?.connectionStatus).toBe("error");
    const connected = f.client.connect();
    f.transport.open("Reconnected Mac");
    await connected;
    expect(f.store.getHosts().map((host) => host.label)).toEqual(["Reconnected Mac"]);
    expect(f.storage.saved().map((host) => host.label)).toEqual(["Reconnected Mac"]);
    expect(f.probes()).toBe(1);
  });

  it("rejects queued callbacks from a replaced connection generation", async () => {
    const f = fixture();
    await f.store.boot();
    const host = await importHost(f.store);
    await online(f, null);
    const info = f.client.getLastServerInfoMessage();
    if (!info) throw new Error("missing server_info");
    const staleCallbacks = [...f.client.statusCallbacks];
    expect(staleCallbacks.length).toBe(1);
    const next = fixture();
    f.replaceClient(next.client);
    const finishClose = new Deferred<void>();
    f.client.closeGate = finishClose.promise;
    await f.store.upsertRelayConnection({
      serverId: SERVER_ID,
      relayEndpoint: "relay.invalid:443",
      useTls: true,
      daemonPublicKeyB64: "replacement-public-key",
    });
    await f.client.closing.promise;
    try {
      expect(f.client.getConnectionState().status).toBe("connected");
      for (const callback of staleCallbacks)
        callback({ type: "status", payload: { ...info, hostname: "Stale Mac" } });
      expect(f.store.getHosts().map((profile) => profile.label)).toEqual([host.label]);
    } finally {
      finishClose.resolve();
    }
    await next.transport.ready.promise;
    const ready = new Promise<void>((resolve) => {
      const unsubscribe = f.store.subscribe(SERVER_ID, () => {
        if (f.store.getSnapshot(SERVER_ID)?.connectionStatus !== "online") return;
        unsubscribe();
        resolve();
      });
    });
    next.transport.open("Current Mac");
    await ready;
    expect(f.storage.saved().map((profile) => profile.label)).toEqual(["Current Mac"]);
  });

  it("does not let a removed host's queued callback rename a re-added host with the same id", async () => {
    const f = fixture();
    await f.store.boot();
    await importHost(f.store);
    await online(f, null);
    const info = f.client.getLastServerInfoMessage();
    if (!info) throw new Error("missing server_info");
    const staleCallbacks = [...f.client.statusCallbacks];
    await f.store.removeHost(SERVER_ID);
    await importHost(f.store);
    for (const callback of staleCallbacks)
      callback({ type: "status", payload: { ...info, hostname: "Removed Mac" } });
    expect(f.store.getHosts().map((host) => host.label)).toEqual([SERVER_ID]);
    expect(f.storage.saved().map((host) => host.label)).toEqual([SERVER_ID]);
  });

  it("rechecks cached server_info after hydration instead of persisting before the registry is loaded", async () => {
    const storage = new MemoryRegistry();
    const f = fixture(storage);
    await importHost(f.store);
    const before = storage.writes.length;
    await online(f, "Hydrated Mac");
    expect(f.store.isHostRegistryLoaded()).toBe(false);
    expect(storage.writes.length).toBe(before);
    expect(storage.saved().map((profile) => profile.label)).toEqual([SERVER_ID]);
    await f.store.boot();
    expect(f.store.getHosts().map((profile) => profile.label)).toEqual(["Hydrated Mac"]);
    expect(storage.saved().map((profile) => profile.label)).toEqual(["Hydrated Mac"]);
    expect(f.probes()).toBe(1);
  });

  it("waits for registry hydration before importing a link and keeps existing renamed hosts", async () => {
    const storage = new MemoryRegistry();
    const saved = fixture(storage);
    await saved.store.boot();
    const original = await importHost(saved.store);
    const oldHost = { ...original, serverId: "srv_saved", label: "Saved Mac" };
    storage.values.set(REGISTRY_KEY, JSON.stringify([oldHost]));
    const load = new Deferred<void>();
    storage.loadGate = load.promise;
    const f = fixture(storage);
    const boot = f.store.boot();
    const offer = {
      v: 2,
      serverId: SERVER_ID,
      daemonPublicKeyB64: "synthetic-key",
      relay: { endpoint: "other.invalid:443", useTls: true },
    };
    const link = `woowtech-smart:///#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
    const imports: string[] = [];
    const pairing = handlePairingLink(link, {
      hosts: f.store,
      importOffer: (value) => {
        imports.push("import");
        return f.store.upsertConnectionFromOfferUrl(value);
      },
      openProject: () => {},
      isCancelled: () => false,
    });
    await Promise.resolve();
    expect(imports).toEqual([]);
    load.resolve();
    await boot;
    await pairing;
    expect(f.store.getHosts().map((host) => host.label)).toEqual(["Saved Mac", SERVER_ID]);
    await online(f, "Imported Mac");
    expect(f.storage.saved().map((host) => host.label)).toEqual(["Saved Mac", "Imported Mac"]);
  });
});
