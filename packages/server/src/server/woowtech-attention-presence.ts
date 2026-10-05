// woowtech smart: fork-owned rules on top of agent-attention-policy.ts.
// PROPOSAL (not merged): see ~/.local/share/woowtech-smart/proposals/push-behaviour.md.
import type { ClientPresenceState } from "./agent-attention-policy.js";

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
