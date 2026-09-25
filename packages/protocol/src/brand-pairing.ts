// Where woowtech smart's pairing links and QR codes send people: straight into the
// app, through the link scheme packages/app/app.config.js registers (owner decision
// 直接叫起 App). Upstream's open its hosted web app instead. The daemon writes this
// into new homes as app.baseUrl and falls back to it, and the app shows it as the
// example pairing link.

const APP_LINK_SCHEME = "woowtech-smart";

// The app's root URL, the one Expo Router opens on a plain launch
// (Linking.createURL("/")). Expo Router routes a custom-scheme link by its host and
// path and ignores the fragment, so `woowtech-smart:///#offer=…` lands on the index
// route, which exists before the app's stores are ready. A host would become the
// first route segment: `woowtech-smart://pair#offer=…` would open an unmatched route.
const APP_ROOT_URL = `${APP_LINK_SCHEME}:///`;

export const BRAND_PAIRING = {
  /**
   * The daemon's default `app.baseUrl`. Pairing links are this URL with
   * `#offer=<base64url JSON>` after it: `woowtech-smart:///#offer=…`.
   */
  appBaseUrl: APP_ROOT_URL,
  /** A pairing link as the app's "Paste pairing link" field shows it. */
  linkExample: `${APP_ROOT_URL}#offer=...`,
} as const;
