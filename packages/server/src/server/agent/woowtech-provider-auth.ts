import type { ProviderAuthStatus } from "@getpaseo/protocol/woowtech-provider-auth";
import type { AgentClient, ProviderRefreshContext } from "./agent-sdk-types.js";
import { raceProviderRefreshAbort } from "./provider-refresh-deadline.js";

/**
 * woowtech smart: a ready provider's login state, for display (woowtech/README.md §3).
 * Never rejects, so it cannot turn a ready provider into an error: a client without a login
 * state, or one that fails to read it, publishes none. Only the two known fields are copied,
 * so a client cannot put anything else into the snapshot this way.
 */
export async function readProviderAuthStatus(
  client: AgentClient,
  context: ProviderRefreshContext,
): Promise<ProviderAuthStatus | undefined> {
  const getAuthStatus = client.getAuthStatus?.bind(client);
  if (!getAuthStatus) return undefined;
  try {
    const status = await context.runActivity("auth", () =>
      raceProviderRefreshAbort(context.signal, getAuthStatus(context.signal)),
    );
    if (typeof status?.state !== "string") return undefined;
    return typeof status.method === "string"
      ? { state: status.state, method: status.method }
      : { state: status.state };
  } catch {
    return undefined;
  }
}
