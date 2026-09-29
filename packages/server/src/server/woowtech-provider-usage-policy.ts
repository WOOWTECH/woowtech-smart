// Account usage (plan quota) reads each provider's saved credentials, such as Claude's
// OAuth token from ~/.claude or the macOS keychain, and sends them to the provider's
// quota API. The owner turned it off on 2026-09-29, so the daemon answers the usage RPC
// with an empty list. Per-session token and context counts come from agent events and
// do not go through this policy.
export function isProviderUsageFetchingEnabled(): boolean {
  return false;
}
