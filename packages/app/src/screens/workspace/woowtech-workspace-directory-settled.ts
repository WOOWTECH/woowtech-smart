import { useSyncExternalStore } from "react";
import { getHostRuntimeStore, type HostRuntimeSnapshot } from "@/runtime/host-runtime";

// woowtech smart (woowtech/README.md, 16 T1 S1): a notification can open a workspace created
// while the app was in the background. Its descriptor arrives with the reconnect's directory
// refresh, and a recovery inspection sent before that answered "unavailable" for 0.6-0.9 s.
// A workspace missing from the directory is judged only after this connection's refresh ends.

type DirectorySettledSnapshot = Pick<
  HostRuntimeSnapshot,
  "clientGeneration" | "connectionEpoch" | "demandRefreshSettledFor"
>;

/** Whether the directory refresh of the host's current connection has ended, well or not. */
export function isDirectoryRefreshSettled(snapshot: DirectorySettledSnapshot | null): boolean {
  const settled = snapshot?.demandRefreshSettledFor;
  return Boolean(
    settled &&
    settled.clientGeneration === snapshot.clientGeneration &&
    settled.connectionEpoch === snapshot.connectionEpoch,
  );
}

export function useDirectoryRefreshSettled(serverId: string): boolean {
  const store = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(serverId, onStoreChange),
    () => isDirectoryRefreshSettled(store.getSnapshot(serverId)),
    () => isDirectoryRefreshSettled(store.getSnapshot(serverId)),
  );
}

/** A workspace can be judged missing once the directory has loaded on this connection. */
export function hasSettledWorkspaceDirectory(input: {
  hasHydratedWorkspaces: boolean;
  directoryRefreshSettled: boolean;
}): boolean {
  return input.hasHydratedWorkspaces && input.directoryRefreshSettled;
}
