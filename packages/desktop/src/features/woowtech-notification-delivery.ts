export type NotificationDeliveryResult = "shown" | "failed" | "unconfirmed";

export type NotificationDeliveryEvent = "show" | "failed" | "click" | "close";

/** Electron passes the close reason on Windows: userCanceled, applicationHidden or timedOut. */
export interface NotificationCloseDetails {
  reason?: string;
}

export interface NotificationDeliveryPort {
  on(
    event: NotificationDeliveryEvent,
    listener: (details?: NotificationCloseDetails) => void,
  ): unknown;
  removeListener(
    event: NotificationDeliveryEvent,
    listener: (details?: NotificationCloseDetails) => void,
  ): unknown;
  show(): void;
  close(): void;
}

export interface NotificationDeliveryInput {
  notification: NotificationDeliveryPort;
  onClick: () => void;
  release: () => void;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  closeOnTimeout?: boolean;
  /**
   * Windows closes a toast with reason timedOut when the banner moves to Action Center. It
   * can still be clicked there, so the listeners and the reference stay (README §25).
   */
  keepAfterTimedOutClose?: boolean;
  /** Reports native events as they arrive, for the main-process log. */
  trace?: (event: NotificationDeliveryEvent, reason?: string) => void;
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

export function showNotificationWithDelivery(
  input: NotificationDeliveryInput,
): Promise<NotificationDeliveryResult> {
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

    function finish(result: NotificationDeliveryResult): void {
      if (settled) return;
      settled = true;
      cancelTimeout();
      notification.removeListener("show", shown);
      resolve(result);
    }

    function shown(): void {
      input.trace?.("show");
      finish("shown");
    }
    function failed(): void {
      input.trace?.("failed");
      finish("failed");
      cleanup();
    }
    function clicked(): void {
      input.trace?.("click");
      try {
        onClick();
      } finally {
        done();
      }
    }
    function closed(details?: NotificationCloseDetails): void {
      input.trace?.("close", details?.reason);
      if (input.keepAfterTimedOutClose && details?.reason === "timedOut") {
        finish("unconfirmed");
        return;
      }
      done();
    }
    function done(): void {
      // A close without show is not delivery evidence.
      finish("unconfirmed");
      cleanup();
    }

    notification.on("show", shown);
    notification.on("failed", failed);
    notification.on("click", clicked);
    notification.on("close", closed);
    cancelTimeout = schedule(() => {
      // Keep ordinary notifications clickable even without timely show evidence.
      finish("unconfirmed");
      if (!input.closeOnTimeout) return;
      cleanup();
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
