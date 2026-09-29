// woowtech smart: every Claude icon in the app is this neutral text badge, the letter C in
// the caller's color inside a rounded square. Anthropic's terms let a product name Claude
// Code in plain text, but using its logo takes written permission; the owner chose the badge
// on 2026-09-27 (woowtech/README.md section 22). The letter is a path, not <text>, so it looks
// the same on iOS, Android and the web without depending on a font.

export const CLAUDE_BADGE_VIEW_BOX = "0 0 24 24";

export const CLAUDE_BADGE_FRAME = {
  x: 2.75,
  y: 2.75,
  width: 18.5,
  height: 18.5,
  rx: 5,
  strokeWidth: 1.75,
} as const;

export const CLAUDE_BADGE_LETTER = {
  d: "M15.1 9A4.25 4.25 0 1 0 15.1 15",
  strokeWidth: 2.25,
} as const;

const frame = CLAUDE_BADGE_FRAME;
const letter = CLAUDE_BADGE_LETTER;

/** The badge as SVG markup in currentColor, for surfaces that render SVG documents. */
export const CLAUDE_BADGE_SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${CLAUDE_BADGE_VIEW_BOX}" fill="none" stroke="currentColor" stroke-linecap="round">`,
  `  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.rx}" stroke-width="${frame.strokeWidth}"/>`,
  `  <path d="${letter.d}" stroke-width="${letter.strokeWidth}"/>`,
  "</svg>",
  "",
].join("\n");

/** Provider ids that stand for Claude: the built-in provider and the ACP catalog's id. */
export function isClaudeProviderId(provider: string): boolean {
  return provider === "claude" || provider === "claude-acp";
}
