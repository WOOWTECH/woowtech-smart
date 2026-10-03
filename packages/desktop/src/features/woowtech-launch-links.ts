// woowtech smart: launch arguments and notification identifiers can carry woowtech-smart:
// links. A pairing link (woowtech-smart:///#offer=…) works like a password (README §19), so
// logs keep only the part before its query or fragment. Agent links
// (woowtech-smart://h/<server>/agent/<agent>) carry ids only and stay readable.
import {
  AGENT_DEEP_LINK_SCHEME,
  buildAgentDeepLink,
  parseAgentDeepLink,
  type AgentDeepLinkTarget,
} from "@getpaseo/protocol/agent-deep-link";

const APP_LINK_PREFIX = `${AGENT_DEEP_LINK_SCHEME}:`;
const OFFER_PARAMETER = /[#?&]offer=/i;
const QUERY_OR_FRAGMENT = /[?#]/;

export function isAppSchemeLink(arg: string): boolean {
  return arg.trim().toLowerCase().startsWith(APP_LINK_PREFIX);
}

/** True when a launch carries any woowtech-smart: link, agent link or not. */
export function hasAppSchemeLink(argv: readonly string[]): boolean {
  return argv.some(isAppSchemeLink);
}

export function redactLaunchArgument(arg: string): string {
  const cut = isAppSchemeLink(arg) ? arg.search(QUERY_OR_FRAGMENT) : arg.search(OFFER_PARAMETER);
  return cut === -1 ? arg : `${arg.slice(0, cut + 1)}<redacted>`;
}

export function redactLaunchArguments(argv: readonly string[]): string[] {
  return argv.map(redactLaunchArgument);
}

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

/**
 * A Windows protocol toast can deliver one click twice: Electron's `click` and the protocol
 * relaunch (plan B8, H5 F7). Opening the same agent again within the window is dropped.
 */
export function createDuplicateLaunchFilter(
  windowMs = 2_000,
  now: () => number = () => Date.now(),
): (target: AgentDeepLinkTarget) => boolean {
  let last: { key: string; at: number } | null = null;
  return (target) => {
    const key = `${target.serverId}\n${target.agentId}`;
    const at = now();
    if (last && last.key === key && at - last.at < windowMs) {
      return false;
    }
    last = { key, at };
    return true;
  };
}

// macOS returns the identifier of the notification that launched the app in the ready
// event's launchInfo. The unique part keeps two notifications for one agent from replacing
// each other in Notification Center.
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
