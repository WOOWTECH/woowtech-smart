import { getHostRuntimeStore, type HostRuntimeStore } from "./host-runtime";

// woowtech smart (fork-owned; woowtech/README.md, 19): pairing links and QR codes open the app
// itself, as woowtech-smart:///#offer=<payload>. Upstream's OfferLinkListener (app/_layout.tsx)
// hands every link the app is opened with to handlePairingLink, which the fork owns and tests.

/** The part of the host store a pairing link waits on. */
export type HostRegistry = Pick<HostRuntimeStore, "isHostRegistryLoaded" | "subscribeHostList">;

export interface PairingLinkHandlers {
  /** Saves the host the link's offer names: HostRuntimeStore.upsertConnectionFromOfferUrl. */
  importOffer(url: string): Promise<unknown>;
  /** Goes to "open project" once the host is saved. */
  openProject(): void;
  /** Whether the listener that got the link has gone. */
  isCancelled(): boolean;
  /** The saved hosts the import adds to. Defaults to the app's host store. */
  hosts?: HostRegistry;
  warn?: (message: string, error: unknown) => void;
}

/** Resolves once the store has loaded the saved hosts (HostRuntimeStore.boot). */
export function whenHostRegistryLoaded(hosts: HostRegistry): Promise<void> {
  if (hosts.isHostRegistryLoaded()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = hosts.subscribeHostList(() => {
      if (!hosts.isHostRegistryLoaded()) return;
      unsubscribe();
      resolve();
    });
  });
}

/** The saved host's server id, when the import returned one. */
function importedServerId(profile: unknown): string | null {
  if (typeof profile !== "object" || profile === null || !("serverId" in profile)) return null;
  const { serverId } = profile;
  return typeof serverId === "string" && serverId.length > 0 ? serverId : null;
}

/**
 * A link with an offer in its fragment saves that host and opens "open project"; any other link
 * is left to Expo Router. Plain string work: React Native's URL class misreads custom-scheme
 * links, and its fragment handling is not reliable.
 */
export async function handlePairingLink(
  url: string | null,
  handlers: PairingLinkHandlers,
): Promise<void> {
  if (!url || !url.includes("#offer=")) return;
  try {
    // A link that starts the app can be read before the store loads the saved hosts. Imported
    // then, the new host goes into an empty list, which is saved over the saved hosts, and the
    // saved hosts then load over it: the new host is gone from the screen, and the next launch
    // has only the new host.
    await whenHostRegistryLoaded(handlers.hosts ?? getHostRuntimeStore());
    const profile = await handlers.importOffer(url);
    if (handlers.isCancelled() || importedServerId(profile) === null) return;
    handlers.openProject();
  } catch (error) {
    if (handlers.isCancelled()) return;
    (handlers.warn ?? console.warn)("[Linking] Failed to import pairing offer", error);
  }
}
