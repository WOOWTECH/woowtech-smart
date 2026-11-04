// The relay the brand's daemons and phones meet through when they are not on the same
// network: a Cloudflare Worker that the brand runs, relay.woowtech.io for woowtech smart
// (packages/relay/wrangler.woowtech.toml). The daemon connects to it unless the user
// turns the relay off, and its pairing offers send phones to it.
import { BRAND } from "./brand-values.js";

const RELAY_HOST = BRAND.services.relayHost;

export const BRAND_RELAY = {
  host: RELAY_HOST,
  /** The daemon's default `daemon.relay.endpoint`. Port 443 means TLS. */
  endpoint: `${RELAY_HOST}:443`,
} as const;
