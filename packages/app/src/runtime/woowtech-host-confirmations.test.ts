import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostConnection, HostProfile, RelayHostConnection } from "@/types/host-connection";
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

/** Starts a confirmation and returns what it asked, or null when it answered without asking. */
async function questionOf(
  confirmations: HostConfirmations,
  answer: Promise<boolean>,
): Promise<{ asked: HostConfirmationRequest | null; answer: Promise<boolean> }> {
  await Promise.resolve();
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
        savedRelayEndpoints: [PRODUCT_RELAY],
        keyFingerprint: formatDaemonKeyFingerprint(KEY_A),
        relayEndpoint: changed.relay.endpoint,
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

  it("asks about a saved host that has only direct connections, which have no key to compare", async () => {
    const lanOnly = host("srv_A", "LAN box", [direct("lan:6770")]);
    const { asked } = await questionOf(
      confirmations,
      confirmations.confirmLink(offer(), [lanOnly]),
    );

    expect(asked).toMatchObject({
      kind: "changedConnection",
      savedLabel: "LAN box",
      savedRelayEndpoints: [],
    });
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

describe("a probe or a direct connection", () => {
  const probe = (
    connection: HostConnection,
    overrides: {
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
      [{ id: "ssh:mac.local::", type: "remoteSsh", host: "mac.local" }, "ssh mac.local → 6770"],
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

  it("does not ask again about a pair it was told no to in this run", async () => {
    const first = await questionOf(confirmations, probe(direct("lan:6770")));
    confirmations.answer(first.asked?.id ?? -1, false);
    await expect(first.answer).resolves.toBe(false);

    await expect(probe(direct("lan:6770"))).resolves.toBe(false);
    expect(confirmations.getPending()).toBeNull();
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
      [{ id: "ssh:mac.local::", type: "remoteSsh", host: "mac.local" }, {}],
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

describe("the probe hook in the host runtime", () => {
  function probeClient() {
    const client = {
      closed: 0,
      async close(): Promise<void> {
        client.closed += 1;
      },
    };
    return client;
  }

  it("closes the probe's connection and throws when the user says no", async () => {
    const client = probeClient();
    const confirming = confirmProbedHost({
      serverId: "srv_A",
      connection: direct("lan:6770"),
      savedHosts: [SAVED_A],
      client,
    });
    await Promise.resolve();
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
    await Promise.resolve();
    hostConfirmations.answer(hostConfirmations.getPending()?.id ?? -1, true);

    await expect(confirming).resolves.toBeUndefined();
    expect(client.closed).toBe(0);
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
    await Promise.resolve();
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
    await Promise.resolve();
    expect(events).toEqual([asked, null]);
  });

  it("answers no to the open question when a new one comes", async () => {
    const first = confirmations.confirmLink(offer(), []);
    await Promise.resolve();
    const firstAsked = confirmations.getPending();
    const second = confirmations.confirmLink(offer({ serverId: "srv_B" }), []);
    await Promise.resolve();

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
        browser: true,
        pageHostname: null,
      }),
    );
    confirmations.answer(refused.asked?.id ?? -1, false);
    await refused.answer;
    const open = confirmations.confirmLink(offer(), []);
    await Promise.resolve();

    confirmations.resetForTests();

    await expect(open).resolves.toBe(false);
    expect(confirmations.getPending()).toBeNull();
    const again = await questionOf(
      confirmations,
      confirmations.confirmProbedConnection({
        serverId: "srv_A",
        connection: direct("lan:6770"),
        savedHosts: [SAVED_A],
        browser: true,
        pageHostname: null,
      }),
    );
    expect(again.asked).toMatchObject({ kind: "directConnectionToSavedHost" });
  });
});
