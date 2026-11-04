// Where the brand's pairing links and QR codes send people: the brand's hosted web app
// (BRAND_WEB_APP: smart.woowtech.io for woowtech smart), as upstream's open its own. The owner
// decided on 2026-10-26 to follow upstream here, which replaces opening the app through its link
// scheme (直接叫起 App); the native apps still open links on the scheme. The daemon writes
// appBaseUrl into new homes as app.baseUrl and falls back to it, and the app shows linkExample as
// the example pairing link. Each brand has its own web app and its own scheme.
import { BRAND } from "./brand-values.js";
import { BRAND_WEB_APP } from "./brand-web-app.js";

const APP_LINK_SCHEME = BRAND.scheme;

// The app's root URL, the one Expo Router opens on a plain launch
// (Linking.createURL("/")). Expo Router routes a custom-scheme link by its host and
// path and ignores the fragment, so `woowtech-smart:///#offer=…` lands on the index
// route, which exists before the app's stores are ready. A host would become the
// first route segment: `woowtech-smart://pair#offer=…` would open an unmatched route.
const APP_ROOT_URL = `${APP_LINK_SCHEME}:///`;

export const BRAND_PAIRING = {
  /** The daemon's default app.baseUrl: pairing links are `${appBaseUrl}/#offer=<base64url JSON>`. */
  appBaseUrl: BRAND_WEB_APP.origin,
  /** A pairing link as the "Paste pairing link" field shows it. */
  linkExample: `${BRAND_WEB_APP.origin}/#offer=...`,
  /**
   * The default app.baseUrl from 2026-09-25 to 2026-10-26 (0.8.1 included). The native app
   * still opens these links; the daemon treats this value in config.json as unset
   * (app-base-url.ts).
   */
  appSchemeRootUrl: APP_ROOT_URL,
} as const;
