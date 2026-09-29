// woowtech smart: Claude's text badge is the vendor badge with the monogram C (vendor-badge.ts).
// Anthropic's terms let a product name Claude Code in plain text, but using its logo takes
// written permission; the owner chose the badge on 2026-09-27 (woowtech/README.md section 22).
import { vendorBadgeSvg } from "./vendor-badge";

/** The Claude badge as SVG markup in currentColor, for surfaces that render SVG documents. */
export const CLAUDE_BADGE_SVG = vendorBadgeSvg("claude");

/** Provider ids that stand for Claude: the built-in provider and the ACP catalog's id. */
export function isClaudeProviderId(provider: string): boolean {
  return provider === "claude" || provider === "claude-acp";
}
