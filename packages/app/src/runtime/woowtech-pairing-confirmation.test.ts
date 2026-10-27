import { describe, expect, it } from "vitest";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import type { HostProfile } from "@/types/host-connection";
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
function registry(hosts: HostProfile[] = []) {
  let loaded = false;
  const listeners = new Set<() => void>();
  const store: PairingHostRegistry = {
    isHostRegistryLoaded: () => loaded,
    subscribeHostList: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getHosts: () => hosts,
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
  for (let turn = 0; turn < 3; turn += 1) await Promise.resolve();
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
      confirmPairingOffer(
        { ...OFFER, serverId: "srv\u202Eevil" },
        { hosts: hosts.store, confirmations },
      ),
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
