// woowtech smart: the base URL of the daemon's pairing links and QR codes. Ours open
// the app through its own link scheme (BRAND_PAIRING); upstream's open its hosted
// web app, and homes created before the change still carry upstream's default in
// config.json. Nobody chose that value, so it counts as unset and the home gets
// our default. Any other value is the user's and stays, as does PASEO_APP_BASE_URL.
import { BRAND_PAIRING } from "@getpaseo/protocol/brand-pairing";

// The only place shipped code names upstream's web app (woowtech/pairing.test.mjs). It is
// also the web app's origin, which woowtech-cors-origins.ts keeps out of CORS.
export const UPSTREAM_DEFAULT_APP_BASE_URL = "https://app.paseo.sh";

/** The app base URL pairing links use, given config.json's `app.baseUrl`. */
export function appBaseUrlFromConfig(configured: string | undefined): string {
  if (
    configured === undefined ||
    configured === UPSTREAM_DEFAULT_APP_BASE_URL ||
    configured === `${UPSTREAM_DEFAULT_APP_BASE_URL}/`
  ) {
    return BRAND_PAIRING.appBaseUrl;
  }
  return configured;
}
