// woowtech smart: launch arguments can carry woowtech-smart: links (macOS notification
// identifiers that carry an agent are in woowtech-notification-launch.ts). A pairing link (woowtech-smart:///#offer=…) works like a password (README §19), so
// logs keep only the part before its query or fragment. Agent links
// (woowtech-smart://h/<server>/agent/<agent>) carry ids only and stay readable.
import {
  AGENT_DEEP_LINK_SCHEME,
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
