import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostConnection, HostProfile, RelayHostConnection } from "@/types/host-connection";
import { HostRuntimeStore, type HostRuntimeControllerDeps } from "./host-runtime";
import {
  BLOCK_KEY_CHANGE,
  confirmProbedHost,
  HostConfirmationDeclinedError,
  HostConfirmations,
  hostConfirmations,
  isHostConfirmationDeclined,
  relayConnectionFromOffer,
  type HostConfirmationRequest,
} from "./woowtech-host-confirmations";
import { formatDaemonKeyFingerprint } from "./woowtech-offer-link";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const PRODUCT_RELAY = "relay.woowtech.io:443";

function offer(overrides: Partial<ConnectionOffer> = {}): ConnectionOffer {
  return {
    v: 2,
    serverId: "srv_A",
    daemonPublicKeyB64: KEY_A,
    relay: { endpoint: PRODUCT_RELAY, useTls: true },
    ...overrides,
  };
}

function relay(endpoint: string, key: string, useTls = true): RelayHostConnection {
  return {
    id: useTls ? `relay:wss:${endpoint}` : `relay:${endpoint}`,
    type: "relay",
    relayEndpoint: endpoint,
    useTls,
    daemonPublicKeyB64: key,
  };
}

function direct(endpoint: string, useTls = false): HostConnection {
  return { id: `direct:${endpoint}`, type: "directTcp", endpoint, useTls };
}

function host(serverId: string, label: string, connections: HostConnection[]): HostProfile {
  return {
    serverId,
    label,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections,
    preferredConnectionId: connections[0]?.id ?? null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const SAVED_A = host("srv_A", "Studio Mac", [relay(PRODUCT_RELAY, KEY_A)]);
const SSH_HOST: HostConnection = { id: "ssh:mac.local::", type: "remoteSsh", host: "mac.local" };

/** Lets a question that first waited on something reach the user. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

/** Starts a confirmation and returns what it asked, or null when it answered without asking. */
async function questionOf(
  confirmations: HostConfirmations,
  answer: Promise<boolean>,
): Promise<{ asked: HostConfirmationRequest | null; answer: Promise<boolean> }> {
  await settle();
  return { asked: confirmations.getPending(), answer };
}

let confirmations: HostConfirmations;

beforeEach(() => {
  confirmations = new HostConfirmations();
  hostConfirmations.resetForTests();
});

afterEach(() => {
  confirmations.resetForTests();
  hostConfirmations.resetForTests();
});

describe("a pairing link", () => {
  it("asks about a host that is not saved", async () => {
    const { asked, answer } = await questionOf(
      confirmations,
      confirmations.confirmLink(offer(), []),
    );

    expect(asked).toEqual({
      id: expect.any(Number),
      kind: "newHost",
      serverId: "srv_A",
      keyFingerprint: formatDaemonKeyFingerprint(KEY_A),
      relayEndpoint: PRODUCT_RELAY,
      relayUseTls: true,
      usesProductRelay: true,
    });
    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
  });

  it("connects without asking when the saved host has exactly this connection", async () => {
    await expect(confirmations.confirmLink(offer(), [SAVED_A])).resolves.toBe(true);
    expect(confirmations.getPending()).toBeNull();
  });

  it("asks with the saved name and relays when the same key comes through another relay or TLS", async () => {
    const otherRelay = offer({ relay: { endpoint: "relay.example.test:443", useTls: true } });
    const noTls = offer({ relay: { endpoint: PRODUCT_RELAY, useTls: false } });
    for (const changed of [otherRelay, noTls]) {
      const { asked, answer } = await questionOf(
        confirmations,
        confirmations.confirmLink(changed, [SAVED_A]),
      );
      expect(asked).toMatchObject({
        kind: "changedConnection",
        serverId: "srv_A",
        savedLabel: "Studio Mac",
        savedRelays: [{ endpoint: PRODUCT_RELAY, useTls: true }],
        keyFingerprint: formatDaemonKeyFingerprint(KEY_A),
        relayEndpoint: changed.relay.endpoint,
        relayUseTls: changed.relay.useTls,
        usesProductRelay: false,
      });
      confirmations.answer(asked?.id ?? -1, false);
      await expect(answer).resolves.toBe(false);
    }
  });

  it("blocks a link that would replace the saved host's key: it can only be closed", async () => {
    expect(BLOCK_KEY_CHANGE).toBe(true);
    const { asked, answer } = await questionOf(
      confirmations,
      confirmations.confirmLink(offer({ daemonPublicKeyB64: KEY_B }), [SAVED_A]),
    );

    expect(asked).toEqual({
      id: expect.any(Number),
      kind: "keyChanged",
      serverId: "srv_A",
      savedLabel: "Studio Mac",
    });
    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(false);
  });

  it("asks about a changed key, as upstream does, when blocking is turned off", async () => {
    const asking = new HostConfirmations({ blockKeyChange: false });
    const { asked, answer } = await questionOf(
      asking,
      asking.confirmLink(offer({ daemonPublicKeyB64: KEY_B }), [SAVED_A]),
    );

    expect(asked).toMatchObject({
      kind: "changedConnection",
      savedLabel: "Studio Mac",
      keyFingerprint: formatDaemonKeyFingerprint(KEY_B),
    });
    asking.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
  });

  it("treats an old offer without useTls on port 443 as the saved wss relay (COMPAT oldRelayOfferTls)", async () => {
    const oldOffer = offer({ relay: { endpoint: PRODUCT_RELAY } });
    expect(relayConnectionFromOffer(oldOffer)).toEqual(relay(PRODUCT_RELAY, KEY_A));
    await expect(confirmations.confirmLink(oldOffer, [SAVED_A])).resolves.toBe(true);
  });

  it("builds the connection the store would save: normalized endpoint, explicit TLS, trimmed key", () => {
    expect(
      relayConnectionFromOffer(
        offer({
          daemonPublicKeyB64: ` ${KEY_A} `,
          relay: { endpoint: " relay.example.test:8443 ", useTls: false },
        }),
      ),
    ).toEqual(relay("relay.example.test:8443", KEY_A, false));
  });

  it("calls only relay.woowtech.io:443 over TLS the product relay", async () => {
    const cases: Array<[ConnectionOffer["relay"], boolean]> = [
      [{ endpoint: PRODUCT_RELAY, useTls: true }, true],
      [{ endpoint: PRODUCT_RELAY }, true],
      [{ endpoint: PRODUCT_RELAY, useTls: false }, false],
      [{ endpoint: "relay.woowtech.io:8443", useTls: true }, false],
      [{ endpoint: "relay.example.test:443", useTls: true }, false],
    ];
    for (const [relayEndpoint, usesProductRelay] of cases) {
      const { asked } = await questionOf(
        confirmations,
        confirmations.confirmLink(offer({ relay: relayEndpoint }), []),
      );
      expect({
        relayEndpoint,
        usesProductRelay: asked?.kind === "newHost" && asked.usesProductRelay,
      }).toEqual({
        relayEndpoint,
        usesProductRelay,
      });
    }
  });
});

// A relay connection saves the daemon's key with it. A host added over a direct connection has
// none, so a link with another key for the same id would be approved with nothing to compare
// against, and the link's key would then answer as that host.
describe("a pairing link for a saved host that has no relay connection", () => {
  const LAN_ONLY = host("srv_A", "LAN box", [direct("lan:6770")]);

  async function asked(
    readDaemonKey: ((saved: HostProfile) => Promise<string | null>) | undefined,
    link: ConnectionOffer = offer(),
  ) {
    return questionOf(
      confirmations,
      confirmations.confirmLink(link, [LAN_ONLY], { readDaemonKey }),
    );
  }

  it("asks, as for any changed connection, once the host's own daemon reports the link's key", async () => {
    const readDaemonKey = vi.fn(async () => KEY_A);
    const question = await asked(readDaemonKey);

    expect(readDaemonKey).toHaveBeenCalledWith(LAN_ONLY);
    expect(question.asked).toMatchObject({
      kind: "changedConnection",
      serverId: "srv_A",
      savedLabel: "LAN box",
      savedRelays: [],
      keyFingerprint: formatDaemonKeyFingerprint(KEY_A),
    });
    confirmations.answer(question.asked?.id ?? -1, true);
    await expect(question.answer).resolves.toBe(true);
  });

  it("blocks the link when the host's own daemon reports another key", async () => {
    const question = await asked(async () => KEY_B);

    expect(question.asked).toEqual({
      id: expect.any(Number),
      kind: "keyChanged",
      serverId: "srv_A",
      savedLabel: "LAN box",
    });
    confirmations.answer(question.asked?.id ?? -1, true);
    await expect(question.answer).resolves.toBe(false);
  });

  it("blocks the link, saying it could not be checked, when there is no key to compare", async () => {
    const readers: Array<[string, ((saved: HostProfile) => Promise<string | null>) | undefined]> = [
      ["the host is offline", async () => null],
      [
        "the call fails",
        async () => {
          throw new Error("timed out");
        },
      ],
      ["nothing can ask", undefined],
    ];
    for (const [reason, readDaemonKey] of readers) {
      const question = await asked(readDaemonKey);

      expect({ reason, asked: question.asked }).toEqual({
        reason,
        asked: {
          id: expect.any(Number),
          kind: "keyUnverified",
          serverId: "srv_A",
          savedLabel: "LAN box",
        },
      });
      confirmations.answer(question.asked?.id ?? -1, true);
      await expect(question.answer).resolves.toBe(false);
    }
  });

  it("does not read the daemon when upstream's ask is turned on, or when the host has a relay key", async () => {
    const readDaemonKey = vi.fn(async () => KEY_B);
    const asking = new HostConfirmations({ blockKeyChange: false });
    const upstream = await questionOf(
      asking,
      asking.confirmLink(offer(), [LAN_ONLY], { readDaemonKey }),
    );
    expect(upstream.asked).toMatchObject({ kind: "changedConnection" });
    asking.answer(upstream.asked?.id ?? -1, false);

    const withRelay = host("srv_A", "Studio Mac", [
      relay(PRODUCT_RELAY, KEY_A),
      direct("lan:6770"),
    ]);
    const throughRelay = await questionOf(
      confirmations,
      confirmations.confirmLink(offer({ daemonPublicKeyB64: KEY_B }), [withRelay], {
        readDaemonKey,
      }),
    );
    expect(throughRelay.asked).toMatchObject({ kind: "keyChanged" });
    expect(readDaemonKey).not.toHaveBeenCalled();
  });
});

// The store merges by a connection as well as by id, and then gives the saved host the new id.
describe("a connection a saved host has, with another host id", () => {
  const OLD_ID = host("srv_old", "Studio Mac", [relay(PRODUCT_RELAY, KEY_A), direct("lan:6770")]);

  it("asks before a link gives the saved host its id", async () => {
    const { asked, answer } = await questionOf(
      confirmations,
      confirmations.confirmLink(offer({ serverId: "srv_new" }), [OLD_ID]),
    );

    expect(asked).toEqual({
      id: expect.any(Number),
      kind: "hostIdChanged",
      serverId: "srv_new",
      savedServerId: "srv_old",
      savedLabel: "Studio Mac",
      endpoint: PRODUCT_RELAY,
    });
    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
  });

  it("does not ask when the host with the connection only has a stand-in id", async () => {
    // HostRuntimeStore's placeholder ids ("local:…") are meant to be replaced by the real id.
    const placeholder = host("local:lan:6770", "local:lan:6770", [direct("lan:6770")]);
    await expect(
      confirmations.confirmProbedConnection({
        serverId: "srv_new",
        connection: direct("lan:6770"),
        savedHosts: [placeholder],
        browser: false,
        pageHostname: null,
      }),
    ).resolves.toBe(true);
    expect(confirmations.getPending()).toBeNull();
  });

  it("asks before a probe gives the saved host its id, on every platform", async () => {
    const overLan = host("srv_old", "Studio Mac", [direct("lan:6770")]);
    const onThisComputer = host("srv_old", "My Mac", [direct("localhost:6770")]);
    const overSsh = host("srv_old", "Mac mini", [SSH_HOST]);
    const cases: Array<[HostProfile, HostConnection, boolean]> = [
      [overLan, direct("lan:6770"), true],
      [overLan, direct("lan:6770"), false],
      [onThisComputer, direct("localhost:6770"), true],
      [onThisComputer, direct("localhost:6770"), false],
      [overSsh, SSH_HOST, false],
    ];
    for (const [saved, connection, browser] of cases) {
      const { asked, answer } = await questionOf(
        confirmations,
        confirmations.confirmProbedConnection({
          serverId: "srv_new",
          connection,
          savedHosts: [saved],
          browser,
          pageHostname: null,
        }),
      );

      expect({ label: saved.label, browser, asked }).toEqual({
        label: saved.label,
        browser,
        asked: {
          id: expect.any(Number),
          kind: "hostIdChanged",
          serverId: "srv_new",
          savedServerId: "srv_old",
          savedLabel: saved.label,
          endpoint: expect.any(String),
        },
      });
      confirmations.answer(asked?.id ?? -1, false);
      await expect(answer).resolves.toBe(false);
    }
  });
});

describe("a probe or a direct connection", () => {
  const probe = (
    connection: HostConnection,
    overrides: {
      background?: boolean;
      browser?: boolean;
      pageHostname?: string | null;
      savedHosts?: HostProfile[];
      serverId?: string;
    } = {},
  ) =>
    confirmations.confirmProbedConnection({
      serverId: overrides.serverId ?? "srv_A",
      connection,
      savedHosts: overrides.savedHosts ?? [SAVED_A],
      background: overrides.background,
      browser: overrides.browser ?? true,
      pageHostname: overrides.pageHostname ?? null,
    });

  it("connects without asking when the saved host already has the connection", async () => {
    const withLan = host("srv_A", "Studio Mac", [relay(PRODUCT_RELAY, KEY_A), direct("lan:6770")]);
    await expect(probe(direct("lan:6770"), { savedHosts: [withLan] })).resolves.toBe(true);
    expect(confirmations.getPending()).toBeNull();
  });

  it("asks before adding a connection to the saved host whose id the daemon reported", async () => {
    const { asked, answer } = await questionOf(confirmations, probe(direct("lan:6770")));

    expect(asked).toEqual({
      id: expect.any(Number),
      kind: "directConnectionToSavedHost",
      serverId: "srv_A",
      savedLabel: "Studio Mac",
      endpoint: "lan:6770",
    });
    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
  });

  it("describes each kind of connection by where it goes", async () => {
    const cases: Array<[HostConnection, string]> = [
      [direct("lan:6770"), "lan:6770"],
      [direct("mac.example.test:7443", true), "mac.example.test:7443 (TLS)"],
      [SSH_HOST, "ssh mac.local → 6770"],
      [
        {
          id: "ssh:mac.local:2222:7000",
          type: "remoteSsh",
          host: "mac.local",
          sshPort: 2222,
          daemonPort: 7000,
        },
        "ssh mac.local:2222 → 7000",
      ],
      [
        { id: "socket:/tmp/paseo.sock", type: "directSocket", path: "/tmp/paseo.sock" },
        "/tmp/paseo.sock",
      ],
      [
        { id: "pipe:\\\\.\\pipe\\paseo", type: "directPipe", path: "\\\\.\\pipe\\paseo" },
        "\\\\.\\pipe\\paseo",
      ],
    ];
    for (const [connection, endpoint] of cases) {
      const { asked } = await questionOf(confirmations, probe(connection));
      expect(asked).toMatchObject({ kind: "directConnectionToSavedHost", endpoint });
      confirmations.answer(asked?.id ?? -1, true);
    }
  });

  it("does not ask again about a pair that was told no to a probe the app started", async () => {
    const first = await questionOf(confirmations, probe(direct("lan:6770"), { background: true }));
    confirmations.answer(first.asked?.id ?? -1, false);
    await expect(first.answer).resolves.toBe(false);

    await expect(probe(direct("lan:6770"), { background: true })).resolves.toBe(false);
    expect(confirmations.getPending()).toBeNull();
  });

  it("asks again every time the user starts the attempt, whatever it was told before", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { asked, answer } = await questionOf(confirmations, probe(direct("lan:6770")));
      expect({ attempt, kind: asked?.kind }).toEqual({
        attempt,
        kind: "directConnectionToSavedHost",
      });
      confirmations.answer(asked?.id ?? -1, false);
      await expect(answer).resolves.toBe(false);
    }

    // A refusal to the app's own probe does not silence the user's attempt either.
    const background = await questionOf(
      confirmations,
      probe(direct("lan:7000"), { background: true }),
    );
    confirmations.answer(background.asked?.id ?? -1, false);
    await background.answer;
    const manual = await questionOf(confirmations, probe(direct("lan:7000")));
    expect(manual.asked).toMatchObject({
      kind: "directConnectionToSavedHost",
      endpoint: "lan:7000",
    });
    confirmations.answer(manual.asked?.id ?? -1, true);
    await expect(manual.answer).resolves.toBe(true);
  });

  it("does not remember a question that a newer one replaced: the user never answered it", async () => {
    const replaced = await questionOf(
      confirmations,
      probe(direct("lan:6770"), { background: true }),
    );
    const newer = confirmations.confirmLink(offer({ serverId: "srv_B" }), []);
    await expect(replaced.answer).resolves.toBe(false);
    expect(replaced.asked?.kind).toBe("directConnectionToSavedHost");
    confirmations.answer(confirmations.getPending()?.id ?? -1, false);
    await newer;

    const again = await questionOf(confirmations, probe(direct("lan:6770"), { background: true }));
    expect(again.asked).toMatchObject({ kind: "directConnectionToSavedHost" });
  });

  it("asks before a browser adds a new host on another machine", async () => {
    for (const endpoint of ["192.168.1.20:6770", "mac.example.test:6770", "[fe80::1]:6770"]) {
      const { asked, answer } = await questionOf(
        confirmations,
        probe(direct(endpoint), { savedHosts: [], serverId: "srv_new" }),
      );
      expect(asked).toEqual({
        id: expect.any(Number),
        kind: "newDirectHost",
        serverId: "srv_new",
        endpoint,
      });
      confirmations.answer(asked?.id ?? -1, false);
      await expect(answer).resolves.toBe(false);
    }
  });

  it("adds new hosts without asking on this computer, outside a browser, over SSH, or from the daemon's own page", async () => {
    const quiet: Array<[HostConnection, { browser?: boolean; pageHostname?: string }]> = [
      [direct("localhost:6770"), {}],
      [direct("127.0.0.1:6770"), {}],
      [direct("[::1]:6770"), {}],
      [direct("192.168.1.20:6770"), { browser: false }],
      [SSH_HOST, {}],
      [direct("192.168.1.20:6770"), { pageHostname: "192.168.1.20" }],
      [direct("Daemon.Example.Test:443", true), { pageHostname: "daemon.example.test" }],
      [direct("[fe80::1]:6770"), { pageHostname: "[fe80::1]" }],
    ];
    for (const [connection, environment] of quiet) {
      await expect(
        probe(connection, { ...environment, savedHosts: [], serverId: "srv_new" }),
      ).resolves.toBe(true);
    }
    expect(confirmations.getPending()).toBeNull();
  });
});

function probeClient() {
  const client = {
    closed: 0,
    async close(): Promise<void> {
      client.closed += 1;
    },
  };
  return client;
}

describe("the probe hook in the host runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes the probe's connection and throws when the user says no", async () => {
    const client = probeClient();
    const confirming = confirmProbedHost({
      serverId: "srv_A",
      connection: direct("lan:6770"),
      savedHosts: [SAVED_A],
      client,
    });
    await settle();
    const asked = hostConfirmations.getPending();
    expect(asked).toMatchObject({ kind: "directConnectionToSavedHost" });
    expect(client.closed).toBe(0);

    hostConfirmations.answer(asked?.id ?? -1, false);
    const error = await confirming.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(HostConfirmationDeclinedError);
    expect(isHostConfirmationDeclined(error)).toBe(true);
    expect(isHostConfirmationDeclined(new Error("offline"))).toBe(false);
    expect(client.closed).toBe(1);
  });

  it("keeps the probe's connection open for the store when the user says yes", async () => {
    const client = probeClient();
    const confirming = confirmProbedHost({
      serverId: "srv_A",
      connection: direct("lan:6770"),
      savedHosts: [SAVED_A],
      client,
    });
    await settle();
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, true);

    await expect(confirming).resolves.toBeUndefined();
    expect(client.closed).toBe(0);
  });

  it("closes the probe's connection when anything on the way throws, and throws the same error", async () => {
    const client = probeClient();
    const broken = new Error("the saved hosts cannot be read");
    const savedHosts = {
      find() {
        throw broken;
      },
    } as unknown as HostProfile[];

    await expect(
      confirmProbedHost({ serverId: "srv_A", connection: direct("lan:6770"), savedHosts, client }),
    ).rejects.toBe(broken);
    expect(client.closed).toBe(1);
    expect(hostConfirmations.getPending()).toBeNull();
  });

  it("does not throw where window has no location, as in a React Native release build", async () => {
    vi.stubGlobal("window", {});
    const client = probeClient();

    await expect(
      confirmProbedHost({
        serverId: "srv_new",
        connection: direct("localhost:6770"),
        savedHosts: [],
        client,
      }),
    ).resolves.toBeUndefined();
    expect(hostConfirmations.getPending()).toBeNull();
    expect(client.closed).toBe(0);
  });
});

// React Native sets window to its global object; a release build gives it no location. The phone
// is not a browser: a new direct host is added without a question, as upstream does.
describe("the probe hook on a phone", () => {
  afterEach(() => {
    vi.doUnmock("@/constants/platform");
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("adds a new direct host without asking, and keeps the probe open", async () => {
    vi.resetModules();
    vi.doMock("@/constants/platform", () => ({ isWeb: false, isNative: true, isDev: false }));
    const phone = await import("./woowtech-host-confirmations");
    vi.stubGlobal("window", {});
    const client = probeClient();

    await expect(
      phone.confirmProbedHost({
        serverId: "srv_new",
        connection: direct("192.168.1.20:6770"),
        savedHosts: [],
        client,
      }),
    ).resolves.toBeUndefined();
    expect(phone.hostConfirmations.getPending()).toBeNull();
    expect(client.closed).toBe(0);
  });

  it("closes the probe's connection when the hook fails, and fails the same way", async () => {
    vi.resetModules();
    vi.doMock("@/constants/platform", () => ({ isWeb: false, isNative: true, isDev: false }));
    const phone = await import("./woowtech-host-confirmations");
    vi.stubGlobal("window", {});
    const client = probeClient();
    const broken = new Error("the saved hosts cannot be read");
    const savedHosts = {
      find() {
        throw broken;
      },
    } as unknown as HostProfile[];

    await expect(
      phone.confirmProbedHost({
        serverId: "srv_new",
        connection: direct("192.168.1.20:6770"),
        savedHosts,
        client,
      }),
    ).rejects.toBe(broken);
    expect(client.closed).toBe(1);
  });
});

describe("the connection a link would save", () => {
  const NO_DAEMONS: HostRuntimeControllerDeps = {
    createClient: () => {
      throw new Error("no daemon connections in this test");
    },
    connectToDaemon: async () => {
      throw new Error("no daemon connections in this test");
    },
    getClientId: async () => "cid_host_confirmations",
  };

  /** A host store over in-memory storage, with its boot ended after the saved hosts load. */
  async function storeThatSaved(link: string): Promise<HostRuntimeStore> {
    const values = new Map<string, string>([["@paseo:e2e", "1"]]);
    const store = new HostRuntimeStore({
      deps: NO_DAEMONS,
      storage: {
        getItem: async (key) => values.get(key) ?? null,
        setItem: async (key, value) => {
          values.set(key, value);
        },
        removeItem: async (key) => {
          values.delete(key);
        },
      },
    });
    await store.boot();
    await store.upsertConnectionFromOfferUrl(link);
    return store;
  }

  // Otherwise a store change (a new id format, a TLS flag no longer written) would leave every
  // test green and ask about a link that is already saved, or save a second copy of it.
  it("is exactly what the host store saves, with and without useTls", async () => {
    const relays: Array<ConnectionOffer["relay"]> = [
      { endpoint: PRODUCT_RELAY, useTls: true },
      { endpoint: PRODUCT_RELAY, useTls: false },
      { endpoint: PRODUCT_RELAY },
      { endpoint: "relay.example.test:8443" },
      { endpoint: " relay.example.test:9443 ", useTls: true },
    ];
    for (const relayOffer of relays) {
      const linked = offer({ relay: relayOffer, daemonPublicKeyB64: ` ${KEY_A} ` });
      const payload = Buffer.from(JSON.stringify(linked)).toString("base64url");
      const store = await storeThatSaved(`https://web.example.test/#offer=${payload}`);
      const saved = store.getHosts();

      expect({ relayOffer, connections: saved[0]?.connections }).toEqual({
        relayOffer,
        connections: [relayConnectionFromOffer(linked)],
      });
      await expect(confirmations.confirmLink(linked, saved)).resolves.toBe(true);
      expect(confirmations.getPending()).toBeNull();
      store.syncHosts([]);
    }
  });
});

describe("one question at a time", () => {
  it("waits for an answer, ignores an answer to another question, and tells subscribers", async () => {
    const events: Array<HostConfirmationRequest | null> = [];
    const unsubscribe = confirmations.subscribe(() => events.push(confirmations.getPending()));
    let settled = false;
    const answer = confirmations.confirmLink(offer(), []).then((approved) => {
      settled = true;
      return approved;
    });
    await settle();
    const asked = confirmations.getPending();

    confirmations.answer((asked?.id ?? 0) + 1, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(confirmations.getPending()).toBe(asked);

    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
    expect(events).toEqual([asked, null]);

    unsubscribe();
    void confirmations.confirmLink(offer({ serverId: "srv_B" }), []);
    await settle();
    expect(events).toEqual([asked, null]);
  });

  it("answers no to the open question when a new one comes", async () => {
    const first = confirmations.confirmLink(offer(), []);
    await settle();
    const firstAsked = confirmations.getPending();
    const second = confirmations.confirmLink(offer({ serverId: "srv_B" }), []);
    await settle();

    await expect(first).resolves.toBe(false);
    expect(confirmations.getPending()).toMatchObject({ serverId: "srv_B" });
    expect(confirmations.getPending()?.id).not.toBe(firstAsked?.id);
    confirmations.answer(firstAsked?.id ?? -1, true);
    expect(confirmations.getPending()).toMatchObject({ serverId: "srv_B" });

    confirmations.answer(confirmations.getPending()?.id ?? -1, true);
    await expect(second).resolves.toBe(true);
  });

  it("resets between tests: no open question and no remembered refusals", async () => {
    const refused = await questionOf(
      confirmations,
      confirmations.confirmProbedConnection({
        serverId: "srv_A",
        connection: direct("lan:6770"),
        savedHosts: [SAVED_A],
        background: true,
        browser: true,
        pageHostname: null,
      }),
    );
    confirmations.answer(refused.asked?.id ?? -1, false);
    await refused.answer;
    const open = confirmations.confirmLink(offer(), []);
    await settle();

    confirmations.resetForTests();

    await expect(open).resolves.toBe(false);
    expect(confirmations.getPending()).toBeNull();
    const again = await questionOf(
      confirmations,
      confirmations.confirmProbedConnection({
        serverId: "srv_A",
        connection: direct("lan:6770"),
        savedHosts: [SAVED_A],
        background: true,
        browser: true,
        pageHostname: null,
      }),
    );
    expect(again.asked).toMatchObject({ kind: "directConnectionToSavedHost" });
  });
});
