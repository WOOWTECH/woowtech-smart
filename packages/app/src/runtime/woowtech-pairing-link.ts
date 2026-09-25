// woowtech smart (fork-owned; woowtech/README.md, 19): pairing links and QR codes open the app
// itself, as woowtech-smart:///#offer=<payload>. Upstream's OfferLinkListener (app/_layout.tsx)
// hands every link the app is opened with to handlePairingLink, which the fork owns and tests.

export interface PairingLinkHandlers {
  /** Saves the host the link's offer names: HostRuntimeStore.upsertConnectionFromOfferUrl. */
  importOffer(url: string): Promise<unknown>;
  /** Goes to "open project" once the host is saved. */
  openProject(): void;
  /** Whether the listener that got the link has gone. */
  isCancelled(): boolean;
  warn?: (message: string, error: unknown) => void;
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
    const profile = await handlers.importOffer(url);
    if (handlers.isCancelled() || importedServerId(profile) === null) return;
    handlers.openProject();
  } catch (error) {
    if (handlers.isCancelled()) return;
    (handlers.warn ?? console.warn)("[Linking] Failed to import pairing offer", error);
  }
}
