import { z } from "zod";
import type { LiteralUnion } from "./literal-union.js";

// woowtech smart: a provider's login state, shown next to its status (woowtech/README.md §3).
// Display only: it never changes the provider's status, and agent creation never checks it.
// State and method are plain strings on the wire, so an app that meets a value added later
// shows it as unknown instead of failing to parse the whole provider snapshot.

export type ProviderAuthState = "signed_in" | "needs_login" | "configured" | "unknown";

export type ProviderAuthMethod =
  | "subscription"
  | "api_key"
  | "auth_token"
  | "oauth_token"
  | "cloud_provider"
  | "api_key_helper"
  | "anthropic_profile";

export interface ProviderAuthStatus {
  state: LiteralUnion<ProviderAuthState, string>;
  method?: LiteralUnion<ProviderAuthMethod, string>;
}

export const ProviderAuthStatusSchema = z.object({
  state: z.string(),
  method: z.string().optional(),
});
