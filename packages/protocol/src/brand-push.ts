// The push relay the daemon sends the brand's phone notifications through: Cloud Run behind a
// Cloudflare Worker (woowtech/README.md §16). Each brand runs its own, because FCM delivers only
// to apps registered in the relay's Firebase project.
import { BRAND } from "./brand-values.js";

export const BRAND_PUSH_RELAY_URL = BRAND.services.pushRelayUrl;
