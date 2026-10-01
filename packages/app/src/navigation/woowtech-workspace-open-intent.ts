import type { WorkspaceOpenIntent } from "@/utils/host-routes";

export interface WorkspaceRouteOpenParams {
  open?: string | string[];
}

/**
 * woowtech smart: the workspace route consumes the `open` intent on its own route only
 * (woowtech/README.md section 16, T1).
 *
 * When a notification enters a workspace from outside the host stack, for example from the
 * root-level Open Project screen, expo-router's router.dismissTo and router.navigate copy every
 * param of the workspace route onto the h/[serverId] route they create, ?open included. The route
 * clears only its own copy after consuming it. useGlobalSearchParams merges both routes, so after
 * each later switch to another workspace it shows the host route's copy again, and the route opens
 * that agent there as a new intent.
 */
export function readWorkspaceRouteOpenParam(params: WorkspaceRouteOpenParams): string {
  const value = Array.isArray(params.open) ? params.open[0] : params.open;
  return typeof value === "string" ? value.trim() : "";
}

export interface AgentOpenIntentWaitInput {
  openIntent: WorkspaceOpenIntent | null;
  /** The store knows the workspace: from the cached directory or the live one. */
  workspaceExists: boolean;
}

/**
 * woowtech smart: an agent intent waits only while the store does not know its workspace
 * (woowtech/README.md section 16, RC-I-21c).
 *
 * Upstream also waited for the first live directory snapshot (hasHydratedWorkspaces). On a cold
 * start from a notification the cached directory knows the workspace long before that snapshot,
 * and while the intent waited the route showed the workspace's remembered agent; with the host
 * unreachable the snapshot never came. A warm tap already opens the agent as soon as the store
 * knows the workspace (navigateToWorkspace). An unknown workspace still waits, for T1's directory
 * demand and for the workspace screen's recovery.
 */
export function isAgentOpenIntentWaitingForWorkspace(input: AgentOpenIntentWaitInput): boolean {
  return input.openIntent?.kind === "agent" && !input.workspaceExists;
}

export interface WorkspaceRecoveryLatchInput {
  openIntent: WorkspaceOpenIntent | null;
  /** The first live directory snapshot has landed (session hasHydratedWorkspaces). */
  hasHydratedWorkspaces: boolean;
}

/**
 * woowtech smart: whether consuming this intent must keep the workspace recovery requested until
 * the live directory decides (woowtech/README.md section 16, RC-I-21c).
 *
 * Upstream (#2002) asked the workspace screen to inspect recovery while ?open=agent:… waited for
 * the live snapshot, so an archived workspace showed 「Workspace archived」 with Restore. Since
 * isAgentOpenIntentWaitingForWorkspace consumes the intent as soon as the cached directory knows
 * the workspace, ?open is gone before the live snapshot can drop a workspace archived meanwhile;
 * the latch keeps the request alive across that gap.
 */
export function shouldLatchWorkspaceRecovery(input: WorkspaceRecoveryLatchInput): boolean {
  return input.openIntent?.kind === "agent" && !input.hasHydratedWorkspaces;
}

export interface WorkspaceRecoveryLatchHoldInput {
  /** The `${serverId}:${workspaceId}` the latch was set for, or null. */
  latchedRouteKey: string | null;
  /** The route's current `${serverId}:${workspaceId}`. */
  routeKey: string;
  hasHydratedWorkspaces: boolean;
  workspaceExists: boolean;
}

/**
 * The latch holds for its own workspace until the live directory has it, the moment upstream
 * consumed the intent and stopped requesting recovery. A workspace the live directory dropped
 * keeps it held, so recovery runs.
 */
export function isWorkspaceRecoveryLatchHeld(input: WorkspaceRecoveryLatchHoldInput): boolean {
  return (
    input.latchedRouteKey !== null &&
    input.latchedRouteKey === input.routeKey &&
    !(input.hasHydratedWorkspaces && input.workspaceExists)
  );
}
