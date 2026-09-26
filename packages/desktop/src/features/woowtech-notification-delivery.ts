export interface NotificationDeliveryPort {
  on(event: "show" | "failed" | "click" | "close", listener: () => void): unknown;
  removeListener(event: "show" | "failed" | "click" | "close", listener: () => void): unknown;
  show(): void;
  close(): void;
}

export interface NotificationDeliveryInput {
  notification: NotificationDeliveryPort;
  onClick: () => void;
  release: () => void;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

export function showNotificationWithDelivery(input: NotificationDeliveryInput): Promise<boolean> {
  const { notification, onClick, release, schedule = scheduleTimeout } = input;
  return new Promise((resolve) => {
    let settled = false;
    let released = false;
    let cancelTimeout = () => {};

    function cleanup(): void {
      if (released) return;
      released = true;
      cancelTimeout();
      notification.removeListener("show", shown);
      notification.removeListener("failed", failed);
      notification.removeListener("click", clicked);
      notification.removeListener("close", closed);
      release();
    }

    function finish(delivered: boolean): void {
      if (settled) return;
      settled = true;
      cancelTimeout();
      notification.removeListener("show", shown);
      if (!delivered) cleanup();
      resolve(delivered);
    }

    function shown(): void {
      finish(true);
    }
    function failed(): void {
      finish(false);
      cleanup();
    }
    function clicked(): void {
      try {
        onClick();
      } finally {
        closed();
      }
    }
    function closed(): void {
      // A close without show is not delivery evidence.
      finish(false);
      cleanup();
    }

    notification.on("show", shown);
    notification.on("failed", failed);
    notification.on("click", clicked);
    notification.on("close", closed);
    cancelTimeout = schedule(() => {
      finish(false);
      try {
        notification.close();
      } catch {
        // Native close can fail too; the unconfirmed result is already settled.
      }
    }, 5_000);
    try {
      notification.show();
    } catch {
      failed();
    }
  });
}
