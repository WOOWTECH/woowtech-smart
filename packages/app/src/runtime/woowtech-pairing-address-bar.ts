// woowtech smart: phones and the desktop app have no address bar to clean; see
// woowtech-pairing-address-bar.web.ts.

export function clearPairingLinkFromAddressBar(): void {}

/**
 * The phone's operating system sends a link again only when the user opens it again, and a
 * QR code scanned again after Cancel should ask again.
 */
export const REMEMBER_HANDLED_PAIRING_LINKS = false;
