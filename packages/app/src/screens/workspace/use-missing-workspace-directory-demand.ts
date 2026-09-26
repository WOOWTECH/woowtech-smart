import { useEffect } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  acquireMissingWorkspaceDirectoryDemand,
  type MissingWorkspaceDirectoryDemandInput,
} from "./missing-workspace-directory-demand";

export function useMissingWorkspaceDirectoryDemand({
  serverId,
  workspaceId,
  isRouteFocused,
  hasWorkspaceDescriptor,
}: MissingWorkspaceDirectoryDemandInput): void {
  useEffect(
    () =>
      acquireMissingWorkspaceDirectoryDemand(getHostRuntimeStore(), {
        serverId,
        workspaceId,
        isRouteFocused,
        hasWorkspaceDescriptor,
      }),
    [serverId, workspaceId, isRouteFocused, hasWorkspaceDescriptor],
  );
}
