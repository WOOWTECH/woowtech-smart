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
