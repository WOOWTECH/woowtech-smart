import { getHostRuntimeStore } from "./host-runtime";
import {
  clearPairingLinkFromAddressBar,
  REMEMBER_HANDLED_PAIRING_LINKS,
} from "./woowtech-pairing-address-bar";
import {
  confirmPairingLink,
  whenHostRegistryLoaded,
  type PairingHostRegistry,
} from "./woowtech-pairing-confirmation";
import { linkMentionsOffer, offerPayloadFromLink } from "./woowtech-offer-link";

// woowtech smart (fork-owned; woowtech/README.md, 19): pairing links and QR codes open the hosted
// web app at its root with the offer in the fragment (BRAND_PAIRING.appBaseUrl). The phone app
// can still be opened by an older daemon's or QR code's woowtech-smart:///#offer=… link.
// Upstream's OfferLinkListener (app/_layout.tsx) hands every link the app is opened with to
// handlePairingLink, which drops the offer from the address bar, asks the user, and only then
// saves the host.

export interface PairingLinkHandlers {
  /** Saves the host the link's offer names: HostRuntimeStore.upsertConnectionFromOfferUrl. */
  importOffer(url: string): Promise<unknown>;
  /** Goes to "open project" once the host is saved. */
  openProject(): void;
  /** Whether the listener that got the link has gone. */
  isCancelled(): boolean;
  /** The saved hosts the link is compared with and added to. Defaults to the app's host store. */
  hosts?: PairingHostRegistry;
  warn?: (message: string, error: unknown) => void;
  /** Asks before saving. Default: confirmPairingLink(url, { hosts }). */
  confirm?: (url: string, hosts: PairingHostRegistry) => Promise<boolean>;
  /** Drops any offer from the address bar on the web; a no-op elsewhere. */
  clearLink?: () => void;
  /** Ignore a link already handled in this page's life. Default: REMEMBER_HANDLED_PAIRING_LINKS. */
  rememberHandled?: boolean;
}

// The web reports the same address for every message event; an effect can run again; iOS can
// report a cold start's link twice.
const linksInFlight = new Set<string>();
// Only with rememberHandled: links asked about once, approved or not, are not asked about again.
const handledLinks = new Set<string>();

export function resetPairingLinksForTests(): void {
  linksInFlight.clear();
  handledLinks.clear();
}

function defaultConfirm(url: string, hosts: PairingHostRegistry): Promise<boolean> {
  return confirmPairingLink(url, { hosts });
}

/** The saved host's server id, when the import returned one. */
function importedServerId(profile: unknown): string | null {
  if (typeof profile !== "object" || profile === null || !("serverId" in profile)) return null;
  const { serverId } = profile;
  return typeof serverId === "string" && serverId.length > 0 ? serverId : null;
}

/**
 * A link whose fragment starts with an offer asks, saves that host and opens "open project"; any
 * other link is left to Expo Router. Plain string work (woowtech-offer-link.ts): React Native's
 * URL class misreads custom-scheme links, and its fragment handling is not reliable.
 */
export async function handlePairingLink(
  url: string | null,
  handlers: PairingLinkHandlers,
): Promise<void> {
  if (!url || !linkMentionsOffer(url)) return;
  // Before anything waits: the offer is a credential, and every message event reports it again.
  (handlers.clearLink ?? clearPairingLinkFromAddressBar)();
  if (offerPayloadFromLink(url) === null) {
    // The message leaves the link out: the offer in it is a credential.
    (handlers.warn ?? console.warn)(
      "[Linking] Ignored a link whose fragment does not start with offer=",
      null,
    );
    return;
  }
  const remember = handlers.rememberHandled ?? REMEMBER_HANDLED_PAIRING_LINKS;
  if (linksInFlight.has(url) || (remember && handledLinks.has(url))) return;
  linksInFlight.add(url);
  if (remember) handledLinks.add(url);
  try {
    const hosts = handlers.hosts ?? getHostRuntimeStore();
    // A link that starts the app can be read before the store loads the saved hosts. Imported
    // then, the new host goes into an empty list, which is saved over the saved hosts, and the
    // saved hosts then load over it: the new host is gone from the screen, and the next launch
    // has only the new host. Asked then, a saved host would look new.
    await whenHostRegistryLoaded(hosts);
    const approved = await (handlers.confirm ?? defaultConfirm)(url, hosts);
    if (!approved) return;
    const profile = await handlers.importOffer(url);
    // A listener that went while the user answered still saves an approved host; it just does
    // not navigate.
    if (handlers.isCancelled() || importedServerId(profile) === null) return;
    handlers.openProject();
  } catch (error) {
    if (handlers.isCancelled()) return;
    (handlers.warn ?? console.warn)("[Linking] Failed to import pairing offer", error);
  } finally {
    linksInFlight.delete(url);
  }
}
