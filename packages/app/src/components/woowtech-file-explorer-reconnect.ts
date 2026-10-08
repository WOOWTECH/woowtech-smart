// woowtech smart (woowtech/README.md section 14): the file explorer loads when its workspace opens,
// and after that only when someone presses Retry (file-explorer-pane.tsx handleRetry). On
// 2026-09-30, once it showed the host-offline error, it kept showing it after the host came back,
// on Android and on the desktop (RC-A-14, RC-D-12b). When the host reconnects while the explorer
// shows an error, this retries once, as pressing Retry would.
import { useEffect, useRef } from "react";

export function useRetryExplorerOnReconnect(input: {
  isConnected: boolean;
  hasError: boolean;
  retry: () => void;
}): void {
  const { isConnected, hasError, retry } = input;
  const wasConnectedRef = useRef(isConnected);

  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (!wasConnected && isConnected && hasError) {
      retry();
    }
  }, [hasError, isConnected, retry]);
}
