// woowtech smart: fork-owned rules on top of agent-attention-policy.ts (woowtech/README.md
// section 16: a backgrounded phone is absent, and nothing notifies while the daemon stops).
import type { ClientPresenceState, NotificationPlan } from "./agent-attention-policy.js";

export interface WoowtechClientActivity {
  deviceType: "web" | "mobile";
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
  lastActivityAt: Date;
  appVisible: boolean;
}

/**
 * Proposal 1. A phone app that is not in the foreground cannot show the in-app notice
 * (sendOsNotification is a no-op on native), so it must not count as present: otherwise it
 * becomes the in-app recipient, the push is skipped and the user sees nothing.
 *
 * Only `deviceType: "mobile"` changes. Web and Electron ("web") keep upstream behaviour: a
 * hidden desktop window still counts as present, because the desktop shows OS banners.
 */
export function woowtechClientPresenceState(activity: WoowtechClientActivity): ClientPresenceState {
  const hiddenPhone = activity.deviceType === "mobile" && !activity.appVisible;
  return {
    appVisible: activity.appVisible,
    focusedAgentId: activity.focusedAgentId,
    focusedTerminalId: activity.focusedTerminalId,
    lastActivityAtMs: hiddenPhone ? null : activity.lastActivityAt.getTime(),
  };
}

/**
 * Proposal 2. Once the daemon is stopping, closing agents interrupts their runs, and the
 * running -> idle edge reads as "finished". Nothing finished, so nobody is notified: no push
 * and no in-app/OS notice. The attention event itself is still delivered to connected
 * clients, so their agent list stays consistent.
 */
export function woowtechNotificationPlanWhileStopping(
  plan: NotificationPlan,
  stopping: boolean,
): NotificationPlan {
  if (!stopping) {
    return plan;
  }
  return { inAppRecipientIndex: null, shouldPush: false };
}
