import React from "react";
import Svg, { Path, Rect } from "react-native-svg";
import {
  VENDOR_BADGE_FRAME,
  VENDOR_BADGE_VIEW_BOX,
  vendorBadgeDrawing,
  vendorMonogram,
  type VendorBadgeDrawing,
} from "./vendor-badge";

// woowtech smart: the vendor text badge as react-native-svg elements (vendor-badge.ts,
// woowtech/README.md section 22).

export interface VendorBadgeIconProps {
  size?: number;
  color?: string;
}

function renderVendorBadge({ letters }: VendorBadgeDrawing, size: number, color: string) {
  const frame = VENDOR_BADGE_FRAME;
  return (
    <Svg width={size} height={size} viewBox={VENDOR_BADGE_VIEW_BOX} fill="none">
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
      {letters ? (
        <Path
          d={letters.d}
          fill="none"
          stroke={color}
          strokeWidth={letters.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  );
}

/** An icon component, with the props provider icons take, that draws `vendor`'s badge. */
export function createVendorBadgeIcon(vendor: string) {
  const drawing = vendorBadgeDrawing(vendorMonogram(vendor));
  function VendorBadgeIcon({ size = 16, color = "currentColor" }: VendorBadgeIconProps) {
    return renderVendorBadge(drawing, size, color);
  }
  VendorBadgeIcon.displayName = `VendorBadgeIcon(${vendor})`;
  return VendorBadgeIcon;
}

/** The badge for a vendor id known only at render time, such as a desktop editor's. */
export function VendorBadge({
  vendor,
  size = 16,
  color = "currentColor",
}: VendorBadgeIconProps & { vendor: string }) {
  return renderVendorBadge(vendorBadgeDrawing(vendorMonogram(vendor)), size, color);
}
