import React from "react";
import Svg, { Path, Rect } from "react-native-svg";
import { CLAUDE_BADGE_FRAME, CLAUDE_BADGE_LETTER, CLAUDE_BADGE_VIEW_BOX } from "./claude-badge";

interface ClaudeIconProps {
  size?: number;
  color?: string;
}

// woowtech smart: a neutral text badge instead of Anthropic's Claude logo (woowtech/README.md §21).
export function ClaudeIcon({ size = 16, color = "currentColor" }: ClaudeIconProps) {
  const frame = CLAUDE_BADGE_FRAME;
  return (
    <Svg width={size} height={size} viewBox={CLAUDE_BADGE_VIEW_BOX} fill="none">
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        rx={frame.rx}
        fill="none"
        stroke={color}
        strokeWidth={frame.strokeWidth}
      />
      <Path
        d={CLAUDE_BADGE_LETTER.d}
        fill="none"
        stroke={color}
        strokeWidth={CLAUDE_BADGE_LETTER.strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
