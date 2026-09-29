import { useTimeAgo } from "@/hooks/use-time-ago";

/**
 * woowtech smart: how long ago a desktop agent tab's agent was active, for the line under the
 * tab's tooltip title ("a1b2c3d · 5m ago").
 *
 * Upstream turns the compact tab label ("5m") back into prose by appending an English " ago".
 * The fork translates the compact labels (woowtech.time, README section 14), so zh-TW read
 * "5 分 ago" and "9月27日 ago". The prose label is translated as a whole and reads the same as
 * upstream's in English: "just now", "5m ago", "Jan 15".
 */
export function useAgentTabTooltipActivity(lastActivityAt: Date | null): string {
  return useTimeAgo(lastActivityAt);
}
