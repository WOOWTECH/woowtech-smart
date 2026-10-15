// Only same-brand pairing (owner decision 2026-10-15, woowtech/README.md §27): woowtech smart's
// app uses woowtech smart's computers, Apporo smart's uses Apporo smart's. Each brand's push
// relay sends only to apps of its own Firebase project, so a phone paired across brands would
// never get a notification. The daemon names its brand in server_info, and the client stops at a
// daemon of another brand. The daemon in turn turns away the app of another brand, which also
// covers apps from before clients checked.
import { BRAND } from "./brand-values.js";

/** The brand this build is, as the daemon reports it in server_info. */
export const BRAND_IDENTITY = { id: BRAND.id, name: BRAND.name };

/** The WebSocket close code for a client and a daemon of different brands. */
export const OTHER_BRAND_CLOSE_CODE = 4004;

/** Why the daemon turns away a client of another brand: the close frame's reason. */
export const OTHER_BRAND_CLIENT_REASON = `This computer runs ${BRAND.name}. Pair it with the ${BRAND.name} app.`;

// COMPAT(brandHandshake): added in v0.8.2, remove after 2027-10-15. Daemons and apps before it
// name no brand; they are all woowtech smart's, or upstream Paseo's, which woowtech smart has
// always paired with.
const UNNAMED_BRAND = "woowtech";

/** Whether an app whose hello names `brand` (none before v0.8.2) is this daemon's brand's. */
export function isSameBrandClient(brand: string | undefined): boolean {
  return (brand ?? UNNAMED_BRAND) === BRAND.id;
}

/** Why this build cannot use a daemon whose server_info names `brand`, or null when it can. */
export function otherBrandReason(brand: { id: string; name: string } | undefined): string | null {
  if ((brand?.id ?? UNNAMED_BRAND) === BRAND.id) {
    return null;
  }
  return brand
    ? `This computer runs ${brand.name}. Pair it with the ${brand.name} app, or install ${BRAND.name} on it.`
    : `This computer runs another app's daemon. Install ${BRAND.name} on it to pair.`;
}
