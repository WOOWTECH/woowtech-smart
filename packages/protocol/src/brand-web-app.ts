// The brand's hosted web app: packages/app's web export, served by Cloudflare Pages at the
// brand's web.host (woowtech/brands), as upstream hosts its own (woowtech/README.md, 19 and 27).
// For woowtech smart that is smart.woowtech.io, project woowtech-smart-web in WoowTech's account.
// Pairing links open it (BRAND_PAIRING.appBaseUrl), and new homes let it reach the daemon
// directly (daemon.cors.allowedOrigins). Owner decisions D1-D3.
import { BRAND } from "./brand-values.js";

const WEB_APP_HOST = BRAND.web.host;

export const BRAND_WEB_APP = {
  host: WEB_APP_HOST,
  /** The browser origin: no trailing slash, no path. The daemon's CORS check matches it exactly. */
  origin: `https://${WEB_APP_HOST}`,
} as const;
