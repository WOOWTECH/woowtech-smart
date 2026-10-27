// woowtech smart's hosted web app: packages/app's web export, served by Cloudflare Pages
// (project woowtech-smart-web, WoowTech's account) at smart.woowtech.io, as upstream hosts its
// own (woowtech/README.md, 19 and 27). Pairing links open it (BRAND_PAIRING.appBaseUrl), and new
// homes let it reach the daemon directly (daemon.cors.allowedOrigins). Owner decisions D1-D3.
const WEB_APP_HOST = "smart.woowtech.io";

export const BRAND_WEB_APP = {
  host: WEB_APP_HOST,
  /** The browser origin: no trailing slash, no path. The daemon's CORS check matches it exactly. */
  origin: `https://${WEB_APP_HOST}`,
} as const;
