// woowtech smart: how the app draws each vendor mark that shows the vendor's own logo, by ACP
// icon id and by desktop editor id (woowtech/README.md section 25). Written by
// woowtech/tools/write-vendor-badges.mjs from woowtech/vendor-marks.mjs; do not edit. A vendor
// that shows its text badge has no entry: the badge draws in the colour its place gives it.

/**
 * How a mark is coloured. theme: in the colour its place gives it (currentColor), the way the
 * ACP registry means its icons. mono: pure black on light themes and pure white on dark ones.
 * original: in its own colours. Where a place may dim or tint its icon, a mono or original
 * mark draws its badge instead.
 */
export type VendorMarkColor = "theme" | "mono" | "original";

export interface VendorMarkStyle {
  readonly color: VendorMarkColor;
  /** The mark may only appear beside its product's name; elsewhere its badge shows. */
  readonly onlyBesideName?: true;
  /** The vendor's own file for dark themes; the mark's own SVG is the one for light themes. */
  readonly onDark?: string;
}

/** The vendors' own files that ACP icons draw on light themes, as downloaded. */
export const OFFICIAL_ACP_ICON_SVGS = {
  grok: "<svg width=\"1024\" height=\"1024\" viewBox=\"0 0 1024 1024\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548 784.406 392.792C826.26 494.285 807.561 616.253 724.288 699.996C641.016 783.739 525.151 802.104 419.247 760.277L303.556 814.143C469.49 928.202 670.987 899.995 796.901 773.282C896.776 672.843 927.708 535.937 898.785 412.476L899.047 412.739C857.105 231.37 909.358 158.874 1016.4 10.6326C1018.93 7.11771 1021.47 3.60279 1024 0L883.144 141.651V141.212L395.392 633.916\" fill=\"#0A0A0A\"/>\n<path d=\"M325.226 695.251C206.128 580.84 226.662 403.776 328.285 301.668C403.431 226.097 526.549 195.254 634.026 240.596L749.454 186.994C728.657 171.88 702.007 155.623 671.424 144.2C533.19 86.9942 367.693 115.465 255.323 228.382C147.234 337.081 113.244 504.215 171.613 646.833C215.216 753.423 143.739 828.818 71.7385 904.916C46.2237 931.893 20.6216 958.87 0 987.429L325.139 695.339\" fill=\"#0A0A0A\"/>\n</svg>\n",
} as const;

/** By ACP icon id (assets/acp-provider-icons.ts). */
export const ACP_ICON_STYLES: Readonly<Record<string, VendorMarkStyle>> = {
  "agoragentic-acp": { color: "theme" },
  autohand: { color: "theme" },
  "cortex-code": { color: "theme" },
  "crow-cli": { color: "theme" },
  cursor: { color: "mono" },
  dimcode: { color: "theme" },
  dirac: { color: "theme" },
  "fast-agent": { color: "theme" },
  gjc: { color: "theme" },
  grok: { color: "mono", onDark: "<svg width=\"1024\" height=\"1024\" viewBox=\"0 0 1024 1024\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<path d=\"M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548 784.406 392.792C826.26 494.285 807.561 616.253 724.288 699.996C641.016 783.739 525.151 802.104 419.247 760.277L303.556 814.143C469.49 928.202 670.987 899.995 796.901 773.282C896.776 672.843 927.708 535.937 898.785 412.476L899.047 412.739C857.105 231.37 909.358 158.874 1016.4 10.6326C1018.93 7.11771 1021.47 3.60279 1024 0L883.144 141.651V141.212L395.392 633.916\" fill=\"white\"/>\n<path d=\"M325.226 695.251C206.128 580.84 226.662 403.776 328.285 301.668C403.431 226.097 526.549 195.254 634.026 240.596L749.454 186.994C728.657 171.88 702.007 155.623 671.424 144.2C533.19 86.9942 367.693 115.465 255.323 228.382C147.234 337.081 113.244 504.215 171.613 646.833C215.216 753.423 143.739 828.818 71.7385 904.916C46.2237 931.893 20.6216 958.87 0 987.429L325.139 695.339\" fill=\"white\"/>\n</svg>\n" },
  junie: { color: "theme" },
  nova: { color: "theme" },
  qoder: { color: "theme" },
  sigit: { color: "theme" },
  stakpak: { color: "theme" },
  vtcode: { color: "theme" },
};

/** By desktop editor id, for the "Open in" button and menu. */
export const EDITOR_ICON_STYLES: Readonly<Record<string, VendorMarkStyle>> = {
  vscode: { color: "original", onlyBesideName: true },
  zed: { color: "original" },
};
