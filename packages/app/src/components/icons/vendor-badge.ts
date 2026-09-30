// woowtech smart: every third-party vendor shows as this neutral text badge instead of its logo:
// a monogram of the vendor's name (one capital, or a capital and a small letter) in the caller's
// color inside a rounded square. Anthropic's terms forbid using its logos without written
// permission, and on 2026-09-29 the owner chose one approach for every vendor instead of a
// per-vendor legal review (woowtech/README.md section 22). The git forges keep their own icons.
//
// The letters are stroked paths, not <text>, so a badge looks the same on iOS, Android and the web
// without depending on a font. The badge has no color of its own: it strokes in the color it is
// given, which is the theme's foreground wherever a provider icon is drawn.

export const VENDOR_BADGE_VIEW_BOX = "0 0 24 24";

export const VENDOR_BADGE_FRAME = {
  x: 2,
  y: 2,
  width: 20,
  height: 20,
  rx: 5.5,
  strokeWidth: 1.5,
} as const;

// Each vendor's monogram, under every id the app knows it by: provider ids, the vendored ACP icon
// ids (assets/acp-provider-icons.ts), terminal profile icons and the desktop's "Open in" editors.
// Vendors shown side by side get different letters; the vendor's name is always shown next to the
// badge, so a shared monogram never has to identify a vendor on its own.
const MONOGRAMS: ReadonlyArray<readonly [string, string]> = [
  // Built-in providers.
  ["claude", "C"],
  ["codex", "Cx"],
  ["copilot", "Gh"],
  ["minimax", "Mm"],
  ["omp", "Om"],
  ["opencode", "Oc"],
  ["pi", "Pi"],
  // ACP agents and terminal profiles.
  ["agoragentic-acp", "Ag"],
  ["agy", "An"],
  ["amp-acp", "Am"],
  ["auggie", "Au"],
  ["autohand", "Ah"],
  ["claude-acp", "C"],
  ["cline", "Cl"],
  ["codebuddy-code", "Cb"],
  ["codewhale", "Cw"],
  ["codex-acp", "Cx"],
  ["cortex-code", "Co"],
  ["corust-agent", "Ct"],
  ["crow-cli", "Cr"],
  ["cursor", "Cu"],
  ["deepagents", "Da"],
  ["dimcode", "Dm"],
  ["dirac", "Di"],
  ["factory-droid", "Fd"],
  ["fast-agent", "Fa"],
  ["gemini", "Ge"],
  ["github-copilot-cli", "Gh"],
  ["gjc", "Ga"],
  ["glm-acp-agent", "Gl"],
  ["goose", "Go"],
  ["grok", "Gr"],
  ["junie", "Ju"],
  ["kilo", "Ki"],
  ["kimi", "Km"],
  ["minimax-code", "Mm"],
  ["minion-code", "Mi"],
  ["mistral-vibe", "Ms"],
  ["nova", "No"],
  ["pi-acp", "Pi"],
  ["poolside", "Po"],
  ["qoder", "Qo"],
  ["qwen-code", "Qw"],
  ["sigit", "Si"],
  ["stakpak", "St"],
  ["traecli", "Tr"],
  ["vtcode", "Vt"],
  // Desktop "Open in" editors.
  ["android-studio", "As"],
  ["antigravity", "An"],
  ["vscode", "Vs"],
  ["webstorm", "Ws"],
  ["zed", "Z"],
  // The help menu's old Discord link (section 10 replaced it; the icon file remains).
  ["discord", "D"],
];

const MONOGRAMS_BY_ID = new Map(MONOGRAMS);

/** The curated monograms by vendor id. */
export const VENDOR_MONOGRAMS: Readonly<Record<string, string>> = Object.fromEntries(MONOGRAMS);

/**
 * The monogram for a vendor id. An id without a curated monogram, such as a custom or plugin
 * provider, gets the first letter of its id, or none when the id has no Latin letter.
 */
export function vendorMonogram(id: string): string {
  const curated = MONOGRAMS_BY_ID.get(id);
  if (curated !== undefined) return curated;
  const letter = /[a-z]/i.exec(id)?.[0];
  return letter ? letter.toUpperCase() : "";
}

// The letters: one stroke-width-free outline per letter in a 10-unit cap height, drawn with
// absolute M, L, H, V, A, Q and Z commands only. y grows downwards: capitals and ascenders
// start at 0, small letters at 3 (the x-height), the baseline is 10 and descenders reach 13.
interface Glyph {
  readonly width: number;
  /** How far below the cap line the lowest stroke reaches: 10 at the baseline. */
  readonly depth?: number;
  readonly d: string;
}

const CAPITALS: Readonly<Record<string, Glyph>> = {
  A: { width: 7, d: "M0 10L3.5 0L7 10M1.33 6.2H5.67" },
  B: { width: 6.3, d: "M0 5H3.4A2.5 2.5 0 0 0 3.4 0H0V10H3.8A2.5 2.5 0 0 0 3.8 5" },
  C: { width: 6.9, d: "M6.9 1.17A4.2 5 0 1 0 6.9 8.83" },
  D: { width: 6.8, d: "M0 0H2.5A4.3 5 0 0 1 2.5 10H0Z" },
  E: { width: 5.5, d: "M5.5 0H0V10H5.5M0 5H4.6" },
  F: { width: 5.3, d: "M5.3 0H0V10M0 5H4.4" },
  G: { width: 8.4, d: "M6.9 1.17A4.2 5 0 1 0 8.4 5H5" },
  H: { width: 6.4, d: "M0 0V10M6.4 0V10M0 5H6.4" },
  I: { width: 3, d: "M0 0H3M1.5 0V10M0 10H3" },
  J: { width: 5, d: "M5 0V7.5A2.5 2.5 0 0 1 0 7.5" },
  K: { width: 6, d: "M0 0V10M6 0L0 6.3M2.3 3.9L6 10" },
  L: { width: 5, d: "M0 0V10H5" },
  M: { width: 8, d: "M0 10V0L4 6.5L8 0V10" },
  N: { width: 6.4, d: "M0 10V0L6.4 10V0" },
  O: { width: 8.4, d: "M4.2 0A4.2 5 0 1 0 4.2 10A4.2 5 0 1 0 4.2 0" },
  P: { width: 6.1, d: "M0 10V0H3.5A2.6 2.6 0 0 1 3.5 5.2H0" },
  Q: {
    width: 8.6,
    depth: 10.6,
    d: "M4.2 0A4.2 5 0 1 0 4.2 10A4.2 5 0 1 0 4.2 0M5.6 7.4L8.6 10.6",
  },
  R: { width: 6.3, d: "M0 10V0H3.5A2.6 2.6 0 0 1 3.5 5.2H0M3.4 5.2L6.3 10" },
  S: { width: 6, d: "M5.6 1.25A3 2.5 0 1 0 3 5A3 2.5 0 1 1 0.4 8.75" },
  T: { width: 7, d: "M0 0H7M3.5 0V10" },
  U: { width: 6.4, d: "M0 0V6.8A3.2 3.2 0 0 0 6.4 6.8V0" },
  V: { width: 7, d: "M0 0L3.5 10L7 0" },
  W: { width: 9, d: "M0 0L2.25 10L4.5 2.6L6.75 10L9 0" },
  X: { width: 6.4, d: "M0 0L6.4 10M6.4 0L0 10" },
  Y: { width: 7, d: "M0 0L3.5 5.2V10M7 0L3.5 5.2" },
  Z: { width: 6, d: "M0 0H6L0 10H6" },
};

const SMALL_LETTERS: Readonly<Record<string, Glyph>> = {
  a: { width: 5.5, d: "M5.5 6.5A2.75 3.5 0 1 0 0 6.5A2.75 3.5 0 1 0 5.5 6.5M5.5 3V10" },
  b: { width: 5.5, d: "M0 0V10M0 6.5A2.75 3.5 0 1 1 5.5 6.5A2.75 3.5 0 1 1 0 6.5" },
  c: { width: 4.8, d: "M4.76 3.82A2.9 3.5 0 1 0 4.76 9.18" },
  d: { width: 5.5, d: "M5.5 0V10M5.5 6.5A2.75 3.5 0 1 0 0 6.5A2.75 3.5 0 1 0 5.5 6.5" },
  e: { width: 5.5, d: "M0 6.5H5.5A2.75 3.5 0 1 0 4.52 9.18" },
  f: { width: 4.2, d: "M4.2 0.24A2.3 2.3 0 0 0 1.5 2.5V10M0 3.3H3.8" },
  g: {
    width: 5.5,
    depth: 13,
    d: "M5.5 6.5A2.75 3.5 0 1 0 0 6.5A2.75 3.5 0 1 0 5.5 6.5M5.5 3V10.8A2.6 2.2 0 0 1 0.46 11.55",
  },
  h: { width: 5.5, d: "M0 0V10M0 6.5A2.75 3.5 0 0 1 5.5 6.5V10" },
  i: { width: 0, d: "M0 3.6V10M0 0V0.2" },
  j: { width: 2.4, depth: 13, d: "M2.4 3.6V11.2A1.8 1.8 0 0 1 0.6 13M2.4 0V0.2" },
  k: { width: 5, d: "M0 0V10M5 3L0 7.3M1.9 5.7L5 10" },
  l: { width: 1.5, d: "M0 0V8.5A1.5 1.5 0 0 0 1.5 10" },
  m: { width: 7.6, d: "M0 10V3M0 6A1.9 3 0 0 1 3.8 6V10M3.8 6A1.9 3 0 0 1 7.6 6V10" },
  n: { width: 5.5, d: "M0 10V3M0 6.5A2.75 3.5 0 0 1 5.5 6.5V10" },
  o: { width: 6, d: "M3 3A3 3.5 0 1 0 3 10A3 3.5 0 1 0 3 3" },
  p: { width: 5.5, depth: 13, d: "M0 3V13M0 6.5A2.75 3.5 0 1 1 5.5 6.5A2.75 3.5 0 1 1 0 6.5" },
  q: { width: 5.5, depth: 13, d: "M5.5 3V13M5.5 6.5A2.75 3.5 0 1 0 0 6.5A2.75 3.5 0 1 0 5.5 6.5" },
  r: { width: 4.2, d: "M0 10V3M0 7Q0.3 3 4.2 3.2" },
  s: { width: 4.8, d: "M4.48 3.88A2.4 1.75 0 1 0 2.4 6.5A2.4 1.75 0 1 1 0.32 9.13" },
  t: { width: 3.8, d: "M1.2 0.8V8.5A1.5 1.5 0 0 0 2.7 10H3.8M0 3.3H3.6" },
  u: { width: 5.5, d: "M0 3V6.5A2.75 3.5 0 0 0 5.5 6.5M5.5 3V10" },
  v: { width: 5.5, d: "M0 3L2.75 10L5.5 3" },
  w: { width: 7.6, d: "M0 3L1.9 10L3.8 4.2L5.7 10L7.6 3" },
  x: { width: 5, d: "M0 3L5 10M5 3L0 10" },
  y: { width: 5.5, depth: 13, d: "M0 3L2.9 9.8M5.5 3L1.7 13" },
  z: { width: 5, d: "M0 3H5L0 10H5" },
};

const CAP_HEIGHT = 10;
const CENTER = 12;
// One capital fills half the frame. Two letters are smaller, with room between them, and shrink
// further when the pair would not fit TEXT_WIDTH, the widest the ink may reach inside the frame.
const ONE_LETTER = { scale: 1, strokeWidth: 2.25 } as const;
const TWO_LETTERS = { scale: 0.85, strokeWidth: 1.85, gap: 2.9 } as const;
const TEXT_WIDTH = 16.7;

export interface VendorBadgeLetters {
  /** Every letter as one path, to stroke in the caller's color. */
  d: string;
  strokeWidth: number;
  /** The capitals' height in viewBox units. */
  capHeight: number;
  /** The letters' cells in viewBox units, strokes not included: cap line to lowest stroke. */
  box: { left: number; right: number; top: number; bottom: number };
}

export interface VendorBadgeDrawing {
  monogram: string;
  /** null draws the frame alone. */
  letters: VendorBadgeLetters | null;
}

const MONOGRAM = /^[A-Z][a-z]?$/;

const drawings = new Map<string, VendorBadgeDrawing>();

/** The frame and the letters of the badge for `monogram`: "" or one capital and a small letter. */
export function vendorBadgeDrawing(monogram: string): VendorBadgeDrawing {
  const cached = drawings.get(monogram);
  if (cached) return cached;
  const drawing = drawMonogram(monogram);
  drawings.set(monogram, drawing);
  return drawing;
}

function drawMonogram(monogram: string): VendorBadgeDrawing {
  if (monogram === "") return { monogram, letters: null };
  if (!MONOGRAM.test(monogram)) {
    throw new Error(`Not a vendor badge monogram: "${monogram}"`);
  }
  const glyphs = [...monogram].map((letter, index) =>
    index === 0 ? CAPITALS[letter] : SMALL_LETTERS[letter],
  );
  const layout = glyphs.length === 1 ? { ...ONE_LETTER, gap: 0 } : TWO_LETTERS;
  const glyphWidth = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  const fitScale = (TEXT_WIDTH - layout.gap - layout.strokeWidth) / glyphWidth;
  const scale = Math.min(layout.scale, fitScale);
  const width = glyphWidth * scale + layout.gap;
  const capHeight = CAP_HEIGHT * scale;
  const left = CENTER - width / 2;
  const top = CENTER - capHeight / 2;

  let x = left;
  const paths = glyphs.map((glyph) => {
    const placed = placePath(glyph.d, scale, x, top);
    x += glyph.width * scale + layout.gap;
    return placed;
  });
  const depth = Math.max(...glyphs.map((glyph) => glyph.depth ?? CAP_HEIGHT));
  return {
    monogram,
    letters: {
      d: paths.join(""),
      strokeWidth: layout.strokeWidth,
      capHeight,
      box: { left, right: left + width, top, bottom: top + depth * scale },
    },
  };
}

/** The badge as SVG markup in currentColor, for surfaces that render SVG documents. */
export function monogramBadgeSvg(monogram: string): string {
  const { letters } = vendorBadgeDrawing(monogram);
  const frame = VENDOR_BADGE_FRAME;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${VENDOR_BADGE_VIEW_BOX}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">`,
    `  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.rx}" stroke-width="${frame.strokeWidth}"/>`,
    ...(letters ? [`  <path d="${letters.d}" stroke-width="${letters.strokeWidth}"/>`] : []),
    "</svg>",
    "",
  ].join("\n");
}

/** The badge for a vendor id as SVG markup in currentColor. */
export function vendorBadgeSvg(id: string): string {
  return monogramBadgeSvg(vendorMonogram(id));
}

const ARGUMENT_COUNTS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  A: 7,
  Q: 4,
  Z: 0,
};

/** `d` scaled by `scale` and moved to (`dx`, `dy`). */
function placePath(d: string, scale: number, dx: number, dy: number): string {
  const x = (value: number) => format(dx + value * scale);
  const y = (value: number) => format(dy + value * scale);
  return [...d.matchAll(/([A-Z])([^A-Z]*)/g)]
    .map(([, command, rest]) => {
      const values =
        rest.trim() === ""
          ? []
          : rest
              .trim()
              .split(/[\s,]+/)
              .map(Number);
      if (values.length !== ARGUMENT_COUNTS[command] || values.some(Number.isNaN)) {
        throw new Error(`Unsupported glyph command: ${command}${rest}`);
      }
      switch (command) {
        case "M":
        case "L":
          return `${command}${x(values[0])} ${y(values[1])}`;
        case "H":
          return `H${x(values[0])}`;
        case "V":
          return `V${y(values[0])}`;
        case "A": {
          const [rx, ry, rotation, largeArc, sweep, endX, endY] = values;
          return `A${format(rx * scale)} ${format(ry * scale)} ${rotation} ${largeArc} ${sweep} ${x(endX)} ${y(endY)}`;
        }
        case "Q":
          return `Q${x(values[0])} ${y(values[1])} ${x(values[2])} ${y(values[3])}`;
        default:
          return "Z";
      }
    })
    .join("");
}

function format(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
