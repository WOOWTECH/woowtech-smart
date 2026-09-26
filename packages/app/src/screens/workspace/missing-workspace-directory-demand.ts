import type { HostRuntimeStore } from "@/runtime/host-runtime";

export interface MissingWorkspaceDirectoryDemandInput {
  serverId: string;
  workspaceId: string;
  isRouteFocused: boolean;
  hasWorkspaceDescriptor: boolean;
}

// A missing notification target has no tab to own agent-route demand yet.
// Keep a directory owner until the descriptor arrives, including while offline.
export function acquireMissingWorkspaceDirectoryDemand(
  runtime: Pick<HostRuntimeStore, "acquireDirectoryDemand">,
  {
    serverId,
    workspaceId,
    isRouteFocused,
    hasWorkspaceDescriptor,
  }: MissingWorkspaceDirectoryDemandInput,
): (() => void) | undefined {
  if (!serverId.trim() || !workspaceId.trim() || !isRouteFocused || hasWorkspaceDescriptor) return;
  return runtime.acquireDirectoryDemand(serverId);
}
