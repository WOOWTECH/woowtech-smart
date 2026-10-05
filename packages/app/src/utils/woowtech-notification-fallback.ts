// woowtech smart (woowtech/README.md section 16): the daemon picks one present client to show an
// agent or terminal notice and skips the push. When this device's system does not show it
// (notifications off, never allowed, no result within 5 seconds, or an error), tell the daemon,
// which then sends the push, and remember for this launch what became of it, so the desktop app
// can say why nothing appeared and whether the phone got it.
import type { AttentionDisplayFailureTarget } from "@getpaseo/protocol/woowtech-attention-fallback";

export interface AttentionDisplayFailureReporter {
  supportsAttentionDisplayFallback(): boolean;
  reportAttentionDisplayFailure(
    target: AttentionDisplayFailureTarget,
  ): Promise<{ outcome: string }>;
}

export interface OsNotificationResultInput {
  /** What sendOsNotification resolved to. */
  shown: boolean;
  /** Phones only show pushes, so a phone never asks the daemon for one. */
  native: boolean;
  client: AttentionDisplayFailureReporter;
  target: AttentionDisplayFailureTarget;
}

/**
 * - `none`: every notice so far was shown.
 * - `sent_to_phone`: a notice was not shown, and the daemon pushed it.
 * - `not_sent`: a notice was not shown, and the daemon did not push it.
 * - `host_too_old`: a notice was not shown, and the daemon cannot push such notices.
 */
export type NotificationDisplayFailure = "none" | "sent_to_phone" | "not_sent" | "host_too_old";

type Listener = () => void;

let displayFailure: NotificationDisplayFailure = "none";
const listeners = new Set<Listener>();

export function subscribeToNotificationDisplayFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotificationDisplayFailure(): NotificationDisplayFailure {
  return displayFailure;
}

/** Once a notice reached the phone, the callout keeps saying so for this launch. */
function recordDisplayFailure(next: Exclude<NotificationDisplayFailure, "none">): void {
  if (displayFailure === "sent_to_phone" || displayFailure === next) {
    return;
  }
  displayFailure = next;
  for (const listener of listeners) {
    listener();
  }
}

export async function handleOsNotificationResult(input: OsNotificationResultInput): Promise<void> {
  if (input.shown || input.native) {
    return;
  }
  if (!input.client.supportsAttentionDisplayFallback()) {
    recordDisplayFailure("host_too_old");
    return;
  }
  try {
    const answer = await input.client.reportAttentionDisplayFailure(input.target);
    recordDisplayFailure(answer.outcome === "pushed" ? "sent_to_phone" : "not_sent");
  } catch (error) {
    console.warn("[Notifications] Could not report a notice this device did not show", error);
    recordDisplayFailure("not_sent");
  }
}

/** Test seam: the failure is process state on purpose. */
export function forgetNotificationDisplayFailureForTest(): void {
  displayFailure = "none";
  listeners.clear();
}
