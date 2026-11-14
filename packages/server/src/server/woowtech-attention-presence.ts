// woowtech smart: fork-owned rules on top of agent-attention-policy.ts (woowtech/README.md
// section 16: a backgrounded phone is absent, nothing notifies while the daemon stops, and with
// no phone to push to the computer used last shows the notice).
import {
  PRESENCE_THRESHOLD_MS,
  type ClientPresenceState,
  type NotificationPlan,
} from "./agent-attention-policy.js";

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

/** A client the notice may go to, with the device type of its last heartbeat. */
export interface WoowtechNoticeCandidate {
  state: ClientPresenceState;
  /** null: the client has never sent a heartbeat. */
  deviceType: "web" | "mobile" | null;
}

/**
 * Without a phone (owner 2026-11-14). With nobody present upstream only pushes, so when no
 * phone has a push token nothing reaches the user: no banner, and nothing in Notification Center
 * to find on return. Then the computer used last (`deviceType: "web"`: the desktop app or a
 * browser) is asked to show the notice, as if its user were present. A phone is never asked (it
 * shows notices only as pushes), nor a client without a heartbeat. A present client that
 * upstream did not pick is looking at the agent or terminal, and then nobody is notified, as
 * before.
 *
 * `clients` are the clients the plan was computed from, in the same order.
 */
export function woowtechNotificationPlanWithoutPhone(input: {
  plan: NotificationPlan;
  clients: WoowtechNoticeCandidate[];
  hasPushTargets: () => boolean;
  nowMs: number;
}): NotificationPlan {
  const { plan, clients, nowMs } = input;
  if (plan.inAppRecipientIndex !== null) {
    return plan;
  }
  const activityAtMs = (state: ClientPresenceState) =>
    state.lastActivityAtMs === null ? null : Math.min(state.lastActivityAtMs, nowMs);
  const someonePresent = clients.some(({ state }) => {
    const atMs = activityAtMs(state);
    return atMs !== null && nowMs - atMs <= PRESENCE_THRESHOLD_MS;
  });
  if (someonePresent) {
    return plan;
  }

  let computerIndex: number | null = null;
  let computerActivityAtMs = Number.NEGATIVE_INFINITY;
  for (const [index, { state, deviceType }] of clients.entries()) {
    const atMs = activityAtMs(state);
    if (deviceType !== "web" || atMs === null) {
      continue;
    }
    if (atMs > computerActivityAtMs) {
      computerIndex = index;
      computerActivityAtMs = atMs;
    }
  }
  if (computerIndex === null || input.hasPushTargets()) {
    return plan;
  }
  return { inAppRecipientIndex: computerIndex, shouldPush: false };
}
