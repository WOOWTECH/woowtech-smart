import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { getHostRuntimeStore, type HostRuntimeStore } from "./host-runtime";
import { hostConfirmations, type HostConfirmations } from "./woowtech-host-confirmations";
import { readPairingOffer, validatePairingOffer } from "./woowtech-offer-link";

// woowtech smart (fork-owned; woowtech/README.md, 19): the confirmation the three pairing entry
// points share. Opening a link (woowtech-pairing-link.ts), scanning a QR code (app/pair-scan.tsx)
// and pasting a link (components/pair-link-modal.tsx) ask here before they probe or save
// anything, where upstream asks inside the host runtime.

/** The part of the host store a pairing confirmation reads. */
export type PairingHostRegistry = Pick<
  HostRuntimeStore,
  "isHostRegistryLoaded" | "subscribeHostList" | "getHosts"
>;

export interface PairingConfirmationOptions {
  /** Defaults to the app's host store. */
  hosts?: PairingHostRegistry;
  /** Defaults to the app's confirmation store, which the sheet at the app root shows. */
  confirmations?: HostConfirmations;
}

/**
 * Resolves once the store has loaded the saved hosts (HostRuntimeStore.boot). A link that starts
 * the app can be read before that; compared with an empty list, a saved host would look new.
 */
export function whenHostRegistryLoaded(
  hosts: Pick<HostRuntimeStore, "isHostRegistryLoaded" | "subscribeHostList">,
): Promise<void> {
  if (hosts.isHostRegistryLoaded()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = hosts.subscribeHostList(() => {
      if (!hosts.isHostRegistryLoaded()) return;
      unsubscribe();
      resolve();
    });
  });
}

/** validatePairingOffer → wait for the saved hosts → HostConfirmations.confirmLink. */
export async function confirmPairingOffer(
  offer: ConnectionOffer,
  options: PairingConfirmationOptions = {},
): Promise<boolean> {
  validatePairingOffer(offer);
  const hosts = options.hosts ?? getHostRuntimeStore();
  await whenHostRegistryLoaded(hosts);
  return (options.confirmations ?? hostConfirmations).confirmLink(offer, hosts.getHosts());
}

/** readPairingOffer(link) → confirmPairingOffer. Throws PairingOfferError for a link it cannot use. */
export async function confirmPairingLink(
  link: string,
  options: PairingConfirmationOptions = {},
): Promise<boolean> {
  return confirmPairingOffer(readPairingOffer(link), options);
}
