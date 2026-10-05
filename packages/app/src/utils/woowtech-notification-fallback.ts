// woowtech smart (woowtech/README.md section 16): the daemon picks one present client to show an
// agent or terminal notice and skips the push. When this device's system does not show it
// (notifications off, never allowed, or no result within 5 seconds), tell the daemon, which then
// sends the push, and remember it for this launch so the desktop app can say why nothing appeared.
import type { AttentionDisplayFailureTarget } from "@getpaseo/protocol/woowtech-attention-fallback";

export interface AttentionDisplayFailureReporter {
  supportsAttentionDisplayFallback(): boolean;
  reportAttentionDisplayFailure(target: AttentionDisplayFailureTarget): Promise<unknown>;
}

export interface OsNotificationResultInput {
  /** What sendOsNotification resolved to. */
  shown: boolean;
  /** Phones only show pushes, so a phone never asks the daemon for one. */
  native: boolean;
  client: AttentionDisplayFailureReporter;
  target: AttentionDisplayFailureTarget;
}

type Listener = () => void;

let displayFailedThisLaunch = false;
const listeners = new Set<Listener>();

export function subscribeToNotificationDisplayFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotificationDisplayFailedThisLaunch(): boolean {
  return displayFailedThisLaunch;
}

function markDisplayFailed(): void {
  if (displayFailedThisLaunch) {
    return;
  }
  displayFailedThisLaunch = true;
  for (const listener of listeners) {
    listener();
  }
}

export async function handleOsNotificationResult(input: OsNotificationResultInput): Promise<void> {
  if (input.shown || input.native) {
    return;
  }
  markDisplayFailed();
  if (!input.client.supportsAttentionDisplayFallback()) {
    return;
  }
  try {
    await input.client.reportAttentionDisplayFailure(input.target);
  } catch (error) {
    console.warn("[Notifications] Could not report a notice this device did not show", error);
  }
}

/** Test seam: the failure is process state on purpose. */
export function forgetNotificationDisplayFailureForTest(): void {
  displayFailedThisLaunch = false;
  listeners.clear();
}
