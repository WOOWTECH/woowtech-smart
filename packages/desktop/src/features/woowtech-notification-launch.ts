// woowtech smart (woowtech/README.md section 16, owner decision D2a): a click on an agent
// notification in Notification Center after the Mac app quit relaunches the app, and macOS hands
// the identifier of that notification to Electron's `ready` event as launchInfo. The identifier
// carries the agent's link, so the relaunched app opens that agent instead of the last workspace.
//
// The same functions live in features/woowtech-launch-links.ts on the Windows branch
// (woowtech/windows-v1), which also handles Windows protocol toasts; merge the two when that
// branch lands.
import {
  buildAgentDeepLink,
  parseAgentDeepLink,
  type AgentDeepLinkTarget,
} from "@getpaseo/protocol/agent-deep-link";

function readId(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The agent a notification points at, from the renderer's notification data. */
export function agentTargetForNotificationData(
  data: Record<string, unknown> | undefined,
): AgentDeepLinkTarget | null {
  const serverId = readId(data, "serverId");
  const agentId = readId(data, "agentId");
  return serverId && agentId ? { serverId, agentId } : null;
}

// The unique part keeps two notifications for one agent from replacing each other in
// Notification Center.
const NOTIFICATION_ID_PREFIX = "woowtech-agent:";

export function agentNotificationId(target: AgentDeepLinkTarget, unique: string): string {
  return `${NOTIFICATION_ID_PREFIX}${unique}:${buildAgentDeepLink(target)}`;
}

export function agentTargetFromNotificationId(id: unknown): AgentDeepLinkTarget | null {
  if (typeof id !== "string" || !id.startsWith(NOTIFICATION_ID_PREFIX)) {
    return null;
  }
  const rest = id.slice(NOTIFICATION_ID_PREFIX.length);
  const separator = rest.indexOf(":");
  return separator === -1 ? null : parseAgentDeepLink(rest.slice(separator + 1));
}

/** Reads Electron's `ready` launchInfo; only a Notification Center launch carries a target. */
export function agentTargetFromLaunchInfo(launchInfo: unknown): AgentDeepLinkTarget | null {
  if (typeof launchInfo !== "object" || launchInfo === null) {
    return null;
  }
  return agentTargetFromNotificationId((launchInfo as { identifier?: unknown }).identifier);
}
