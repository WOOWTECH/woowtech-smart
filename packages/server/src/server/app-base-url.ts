// woowtech smart: the base URL of the daemon's pairing links and QR codes, our hosted web
// app (BRAND_PAIRING). config.json can still carry a default an earlier release wrote: upstream's
// hosted web app (internal test builds), or the app's own link scheme (2026-09-25 to 2026-10-26,
// 0.8.1 included). Nobody chose either, so both count as unset and the home gets our default.
// Only an exact match counts. Any other value is the user's and stays, as does
// PASEO_APP_BASE_URL. config.json itself is not rewritten.
import { BRAND_PAIRING } from "@getpaseo/protocol/brand-pairing";

// The only place shipped code names upstream's web app (woowtech/pairing.test.mjs). It is
// also the web app's origin, which woowtech-cors-origins.ts keeps out of CORS.
export const UPSTREAM_DEFAULT_APP_BASE_URL = "https://app.paseo.sh";

// The defaults earlier releases wrote into new homes, exactly as they wrote them.
const WRITTEN_DEFAULTS: ReadonlySet<string> = new Set([
  UPSTREAM_DEFAULT_APP_BASE_URL,
  `${UPSTREAM_DEFAULT_APP_BASE_URL}/`,
  BRAND_PAIRING.appSchemeRootUrl,
]);

/** The app base URL pairing links use, given config.json's `app.baseUrl`. */
export function appBaseUrlFromConfig(configured: string | undefined): string {
  return configured === undefined || WRITTEN_DEFAULTS.has(configured)
    ? BRAND_PAIRING.appBaseUrl
    : configured;
}
