import { describe, expect, it, vi } from "vitest";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";
import type { HostRuntimeSnapshot } from "./host-runtime";
import { HostConfirmations } from "./woowtech-host-confirmations";
import { PairingOfferError } from "./woowtech-offer-link";
import {
  confirmPairingLink,
  confirmPairingOffer,
  type PairingHostRegistry,
} from "./woowtech-pairing-confirmation";

const OFFER: ConnectionOffer = {
  v: 2,
  serverId: "srv_pair01",
  daemonPublicKeyB64: Buffer.alloc(32, 9).toString("base64"),
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const PAYLOAD = Buffer.from(JSON.stringify(OFFER)).toString("base64url");

/** A host list that loads when the test says so, as HostRuntimeStore.boot loads it. */
function registry(
  hosts: HostProfile[] = [],
  getSnapshot: PairingHostRegistry["getSnapshot"] = () => null,
) {
  let loaded = false;
  const listeners = new Set<() => void>();
  const store: PairingHostRegistry = {
    isHostRegistryLoaded: () => loaded,
    subscribeHostList: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getHosts: () => hosts,
    getSnapshot,
  };
  return {
    store,
    load() {
      loaded = true;
      for (const listener of listeners) listener();
    },
    listening: () => listeners.size,
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

describe("confirming a pairing link", () => {
  it("does not ask until the saved hosts have loaded", async () => {
    const hosts = registry();
    const confirmations = new HostConfirmations();

    const answer = confirmPairingOffer(OFFER, { hosts: hosts.store, confirmations });
    await settle();
    expect(confirmations.getPending()).toBeNull();

    hosts.load();
    await settle();
    expect(confirmations.getPending()).toMatchObject({ kind: "newHost", serverId: "srv_pair01" });
    expect(hosts.listening()).toBe(0);
    confirmations.answer(confirmations.getPending()?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
  });

  it("checks the offer before it waits or asks", async () => {
    const hosts = registry();
    const confirmations = new HostConfirmations();

    await expect(
      confirmPairingOffer({ ...OFFER, serverId: "srv‮evil" }, { hosts: hosts.store, confirmations }),
    ).rejects.toThrow(PairingOfferError);
    await expect(
      confirmPairingOffer(
        { ...OFFER, daemonPublicKeyB64: "short" },
        { hosts: hosts.store, confirmations },
      ),
    ).rejects.toThrow(PairingOfferError);
    expect(hosts.listening()).toBe(0);
    expect(confirmations.getPending()).toBeNull();
  });

  it("reads links the way every pairing entry point does", async () => {
    const hosts = registry();
    hosts.load();
    const confirmations = new HostConfirmations();
    const options = { hosts: hosts.store, confirmations };

    for (const link of [
      `https://web.example.test/#x#offer=${PAYLOAD}`,
      "https://web.example.test/#offer=",
    ]) {
      await expect(confirmPairingLink(link, options)).rejects.toThrow(PairingOfferError);
    }
    expect(confirmations.getPending()).toBeNull();

    const answer = confirmPairingLink(`https://web.example.test/?a=1#offer=${PAYLOAD}`, options);
    await settle();
    expect(confirmations.getPending()).toMatchObject({ kind: "newHost", serverId: "srv_pair01" });
    confirmations.answer(confirmations.getPending()?.id ?? -1, false);
    await expect(answer).resolves.toBe(false);
  });
});

// A host added with "Connect to this computer" or the direct form saved no key. A link with the
// same host id and another key would otherwise be approved with nothing to compare against, and
// the link's key would then answer as that host. The host's own daemon says which key is right.
describe("confirming a link for a saved host that has only a direct connection", () => {
  const DIRECT_HOST: HostProfile = {
    serverId: OFFER.serverId,
    label: "My Mac",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [{ id: "direct:localhost:6770", type: "directTcp", endpoint: "localhost:6770" }],
    preferredConnectionId: "direct:localhost:6770",
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
  };
  const OTHER_KEY = Buffer.alloc(32, 7).toString("base64");

  function offerLink(key: string, serverId = OFFER.serverId): string {
    const offer: ConnectionOffer = { ...OFFER, serverId, daemonPublicKeyB64: key };
    return `https://web.example.test/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
  }

  /** What the host's daemon answers when it is asked for its pairing link. */
  function daemon(
    answer: () => Promise<{ url: string; relayEnabled: boolean }>,
    features: { daemonStatusRpc?: boolean } = { daemonStatusRpc: true },
  ) {
    const getDaemonPairingOffer = vi.fn(answer);
    const client = { getLastServerInfoMessage: () => ({ features }), getDaemonPairingOffer };
    return { client, getDaemonPairingOffer };
  }

  function snapshotOf(client: unknown, connectionStatus: "online" | "offline" = "online") {
    return (serverId: string) =>
      serverId === DIRECT_HOST.serverId
        ? ({ serverId, connectionStatus, client } as unknown as HostRuntimeSnapshot)
        : null;
  }

  async function confirm(link: string, getSnapshot: PairingHostRegistry["getSnapshot"]) {
    const hosts = registry([DIRECT_HOST], getSnapshot);
    hosts.load();
    const confirmations = new HostConfirmations();
    const answer = confirmPairingLink(link, { hosts: hosts.store, confirmations });
    await settle();
    return { confirmations, answer, asked: confirmations.getPending() };
  }

  it("asks, as for any changed connection, when the daemon reports the link's key", async () => {
    const own = daemon(async () => ({
      url: offerLink(OFFER.daemonPublicKeyB64),
      relayEnabled: true,
    }));
    const { confirmations, answer, asked } = await confirm(
      offerLink(OFFER.daemonPublicKeyB64),
      snapshotOf(own.client),
    );

    expect(own.getDaemonPairingOffer).toHaveBeenCalledTimes(1);
    expect(asked).toMatchObject({ kind: "changedConnection", savedLabel: "My Mac" });
    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(true);
  });

  it("blocks the link when the daemon reports another key", async () => {
    const own = daemon(async () => ({
      url: offerLink(OFFER.daemonPublicKeyB64),
      relayEnabled: true,
    }));
    const { confirmations, answer, asked } = await confirm(
      offerLink(OTHER_KEY),
      snapshotOf(own.client),
    );

    expect(own.getDaemonPairingOffer).toHaveBeenCalledTimes(1);
    expect(asked).toMatchObject({ kind: "keyChanged", savedLabel: "My Mac" });
    confirmations.answer(asked?.id ?? -1, true);
    await expect(answer).resolves.toBe(false);
  });

  it("blocks the link, saying it could not be checked, when the daemon cannot say", async () => {
    const cases = [
      {
        reason: "the call fails",
        own: daemon(() => Promise.reject(new Error("timed out"))),
        calls: 1,
      },
      {
        reason: "the daemon's relay is off, so it has no link to give",
        own: daemon(async () => ({ url: "", relayEnabled: false })),
        calls: 1,
      },
      {
        reason: "the daemon answers as another host",
        own: daemon(async () => ({
          url: offerLink(OTHER_KEY, "srv_someone_else"),
          relayEnabled: true,
        })),
        calls: 1,
      },
      {
        reason: "the daemon is too old for the call",
        own: daemon(async () => ({ url: offerLink(OTHER_KEY), relayEnabled: true }), {}),
        calls: 0,
      },
      {
        reason: "the host is offline",
        own: daemon(async () => ({ url: offerLink(OTHER_KEY), relayEnabled: true })),
        status: "offline" as const,
        calls: 0,
      },
    ];
    for (const { reason, own, status, calls } of cases) {
      const { confirmations, answer, asked } = await confirm(
        offerLink(OTHER_KEY),
        snapshotOf(own.client, status),
      );

      expect({ reason, kind: asked?.kind }).toEqual({ reason, kind: "keyUnverified" });
      expect({ reason, calls: own.getDaemonPairingOffer.mock.calls.length }).toEqual({
        reason,
        calls,
      });
      confirmations.answer(asked?.id ?? -1, true);
      await expect(answer).resolves.toBe(false);
    }
  });

  it("blocks the link when the host has no connection to ask over", async () => {
    const { confirmations, answer, asked } = await confirm(offerLink(OTHER_KEY), () => null);

    expect(asked).toMatchObject({ kind: "keyUnverified", savedLabel: "My Mac" });
    confirmations.answer(asked?.id ?? -1, false);
    await expect(answer).resolves.toBe(false);
  });
});
