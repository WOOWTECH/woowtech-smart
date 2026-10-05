// woowtech smart: upstream's hosted web app must never talk to our daemon from the user's
// browser (HTTP and WebSocket both check the CORS allowlist, and the daemon has no password
// by default). New homes start with an empty list, but homes created by internal test builds
// still list upstream's web app in config.json. Nobody chose that entry, so it is dropped
// whenever the config is resolved, at startup and on reload; config.json itself is not
// rewritten. The same goes for PASEO_CORS_ORIGINS. Every other origin stays, "*" included.
import { UPSTREAM_DEFAULT_APP_BASE_URL } from "./app-base-url.js";

// Upstream's default app base URL is also its web app's origin. Like app.baseUrl, it counts
// with or without a trailing slash; anything else, even on upstream's host, is the user's.
const UPSTREAM_WEB_APP_ORIGINS: ReadonlySet<string> = new Set([
  UPSTREAM_DEFAULT_APP_BASE_URL,
  `${UPSTREAM_DEFAULT_APP_BASE_URL}/`,
]);

/** The CORS allowed origins without upstream's hosted web app, in their original order. */
export function withoutUpstreamWebApp(origins: readonly string[]): string[] {
  return origins.filter((origin) => !UPSTREAM_WEB_APP_ORIGINS.has(origin));
}
