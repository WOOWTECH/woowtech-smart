// Applies woowtech/vendor-marks.mjs to the vendor icon files the app and the desktop app ship.
// A vendor that shows its badge gets the badge in its icon component, its vendored SVGs and its
// entries in acp-provider-icons.ts, and its desktop PNG removed. A vendor that shows its upstream
// logo gets its files and entries back exactly as they were at UPSTREAM_REF; one shown from its
// own files gets them copied byte for byte. Then it writes how the app draws each logo
// (woowtech-vendor-mark-styles.gen.ts). woowtech/README.md sections 22 and 25.
//
//   node woowtech/tools/write-vendor-badges.mjs           # write the files
//   node woowtech/tools/write-vendor-badges.mjs --check   # fail when a file does not match
//
// Re-run after changing vendor-marks.mjs or the badge, or after an upstream merge adds a vendor
// icon: woowtech/claude-badge.test.mjs and woowtech/vendor-logos.test.mjs fail until the files
// match.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { repoRoot } from "../shipped-sources.mjs";
import { requireSource } from "../source-modules.mjs";
import { UPSTREAM_REF, VENDOR_MARKS } from "../vendor-marks.mjs";

export const VENDOR_SVG_DIRS = [
  "packages/app/src/assets/acp-provider-icons",
  "packages/app/assets/icons",
];
export const EDITOR_LOGO_DIR = "packages/desktop/assets/editor-targets";
export const ACP_ICONS_FILE = "packages/app/src/assets/acp-provider-icons.ts";
export const MARK_STYLES_FILE =
  "packages/app/src/components/icons/woowtech-vendor-mark-styles.gen.ts";

const SHOWS = new Set(["badge", "upstream", "official"]);
const COLORS = new Set(["theme", "mono", "original"]);
const ACP_KEY = /^ {2}("?)([a-z0-9-]+)\1:/;
const IDENTIFIER = /^[a-z_$][\w$]*$/i;

const readRepoFile = (file) => readFileSync(path.join(repoRoot, file));
const propertyKey = (id) => (IDENTIFIER.test(id) ? id : JSON.stringify(id));

/** Refuses data the tool cannot write faithfully, instead of writing something else. */
function checkMark(vendor, mark) {
  const fail = (problem) => {
    throw new Error(`woowtech/vendor-marks.mjs, ${vendor}: ${problem}`);
  };
  if (!SHOWS.has(mark.show)) fail(`unknown show "${mark.show}"`);
  if (mark.show === "badge") return;
  if (!COLORS.has(mark.color)) fail(`a logo needs color "theme", "mono" or "original"`);
  if (mark.show === "official" && !mark.official?.manifest) fail("official files need a manifest");
  const shipped = shippedLogoFiles(mark);
  if (mark.color !== "theme" && shipped.some((file) => file.endsWith("-icon.tsx"))) {
    // An icon component takes the colour its place gives it; drawing it mono or in its own
    // colours, and never dimmed, needs the places that draw it checked first.
    fail(`an icon component can only show its logo in the theme's colour`);
  }
  if (mark.color !== "original" && shipped.some((file) => file.startsWith(`${EDITOR_LOGO_DIR}/`))) {
    // The desktop app draws an editor's logo as an image, which it cannot recolour.
    fail(`an editor's logo can only show in its own colours, color "original"`);
  }
}

/**
 * The files that ship `mark`'s logo: its upstream files, less the ones that still show its badge,
 * or the vendor's own files.
 */
export function shippedLogoFiles(mark) {
  if (mark.show === "badge") return [];
  if (mark.show === "upstream") return mark.files.filter((file) => !showsBadge(mark, file));
  return Object.keys(mark.official?.files ?? {});
}

for (const [vendor, mark] of Object.entries(VENDOR_MARKS)) checkMark(vendor, mark);

/** A file as it was at UPSTREAM_REF. */
export function upstreamFile(file) {
  return execFileSync("git", ["show", `${UPSTREAM_REF}:${file}`], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Whether `file` of `mark` shows the vendor's badge. */
export function showsBadge(mark, file) {
  return mark.show === "badge" || (mark.badgeFiles ?? []).includes(file);
}

/** The vendor's own file an official ACP icon draws on light themes, and the one for dark. */
function officialAcpIcon(mark, id) {
  const files = mark.official?.acpIcons?.[id];
  if (!files) return null;
  return {
    light: readRepoFile(files.light).toString("utf8"),
    dark: files.dark === undefined ? undefined : readRepoFile(files.dark).toString("utf8"),
  };
}

function badgeComponent(file, logo) {
  const vendor = path.basename(file, "-icon.tsx");
  const name = /export function (\w+)\(/.exec(upstreamFile(file).toString("utf8"))?.[1];
  if (!name || !logo) throw new Error(`${file}: no component name or no logo in vendor-marks.mjs`);
  return [
    'import { createVendorBadgeIcon } from "./vendor-badge-icon";',
    "",
    `// woowtech smart: a neutral text badge instead of ${logo} (woowtech/README.md §22).`,
    `export const ${name} = createVendorBadgeIcon("${vendor}");`,
    "",
  ].join("\n");
}

function badgeFile(file, mark, vendorBadgeSvg) {
  if (file.endsWith("-icon.tsx")) return badgeComponent(file, mark.logo);
  if (file.endsWith(".svg")) return vendorBadgeSvg(path.basename(file, ".svg"));
  return null;
}

/** An upstream file of a vendor shown from its own files: those files take its place. */
function officialInPlaceOf(file, mark) {
  const vendored = officialAcpIcon(mark, path.basename(file, ".svg"));
  if (file.endsWith(".svg") && vendored) return vendored.light;
  if (file.startsWith(`${EDITOR_LOGO_DIR}/`)) return null;
  throw new Error(`${file}: nothing of the vendor's own takes its place (vendor-marks.mjs)`);
}

/**
 * What each vendor icon file must hold, by its path in the repo: the badge, the upstream file or
 * the vendor's own file (text or bytes), or null for a desktop logo that must not ship.
 */
export function expectedVendorFiles() {
  const { vendorBadgeSvg } = requireSource("packages/app/src/components/icons/vendor-badge.ts");
  const expected = {};
  for (const mark of Object.values(VENDOR_MARKS)) {
    for (const file of mark.files) {
      if (showsBadge(mark, file)) {
        expected[file] = badgeFile(file, mark, vendorBadgeSvg);
      } else if (mark.show === "upstream") {
        expected[file] = upstreamFile(file);
      } else {
        expected[file] = officialInPlaceOf(file, mark);
      }
    }
    for (const [shipped, file] of Object.entries(mark.official?.files ?? {})) {
      expected[shipped] = readRepoFile(file);
    }
  }
  return expected;
}

/** Each entry of an acp-provider-icons.ts source, by id, as its lines. */
function acpEntries(source) {
  const entries = new Map();
  let current = null;
  for (const line of source.split("\n")) {
    const key = ACP_KEY.exec(line);
    if (key) {
      current = [line];
      entries.set(key[2], current);
    } else if (line.startsWith("}")) {
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return entries;
}

/** acp-provider-icons.ts with each entry as vendor-marks.mjs says. */
export function expectedAcpIconsSource() {
  const vendorByIcon = new Map(
    Object.values(VENDOR_MARKS).flatMap((mark) => mark.acpIcons.map((id) => [id, mark])),
  );
  const current = acpEntries(readFileSync(path.join(repoRoot, ACP_ICONS_FILE), "utf8"));
  const upstream = acpEntries(upstreamFile(ACP_ICONS_FILE).toString("utf8"));
  let badges = 0;
  let officials = 0;
  const lines = [...current.keys()].flatMap((id) => {
    const mark = vendorByIcon.get(id);
    if (!mark) throw new Error(`${ACP_ICONS_FILE}: add "${id}" to a vendor in vendor-marks.mjs`);
    if (mark.show === "upstream") {
      const entry = upstream.get(id);
      if (!entry)
        throw new Error(`${ACP_ICONS_FILE}: "${id}" has no upstream icon at ${UPSTREAM_REF}`);
      return entry;
    }
    if (mark.show === "official") {
      if (!officialAcpIcon(mark, id)) throw new Error(`${ACP_ICONS_FILE}: "${id}" has no file`);
      officials += 1;
      const accessor = IDENTIFIER.test(id) ? `.${id}` : `[${JSON.stringify(id)}]`;
      return [`  ${propertyKey(id)}: OFFICIAL_ACP_ICON_SVGS${accessor},`];
    }
    badges += 1;
    return [`  ${propertyKey(id)}: vendorBadgeSvg("${id}"),`];
  });
  return [
    "// Vendored ACP provider SVG assets.",
    "",
    ...(badges > 0
      ? [
          "// woowtech smart: a vendor whose logo is not cleared shows its neutral text badge. Written",
          "// by woowtech/tools/write-vendor-badges.mjs from woowtech/vendor-marks.mjs (README §22).",
          'import { vendorBadgeSvg } from "../components/icons/vendor-badge";',
          "",
        ]
      : []),
    ...(officials > 0
      ? [
          "// woowtech smart: a vendor shown from its own files draws them as downloaded (README §25).",
          'import { OFFICIAL_ACP_ICON_SVGS } from "../components/icons/woowtech-vendor-mark-styles.gen";',
          "",
        ]
      : []),
    "export const ACP_PROVIDER_ICON_SVGS = {",
    ...lines,
    "} as const;",
    "",
  ].join("\n");
}

/** The desktop editor ids whose icons a vendor ships as its logo. */
function editorLogoIds(mark) {
  return mark.files
    .concat(Object.keys(mark.official?.files ?? {}))
    .filter((file) => file.startsWith(`${EDITOR_LOGO_DIR}/`) && !showsBadge(mark, file))
    .filter((file) => mark.show === "upstream" || !mark.files.includes(file))
    .map((file) => path.basename(file).replace(/\.(?:png|svg)$/, ""));
}

function styleSource(mark, dark) {
  const fields = [`color: ${JSON.stringify(mark.color)}`];
  if (mark.onlyBesideName) fields.push("onlyBesideName: true");
  if (dark !== undefined) fields.push(`onDark: ${JSON.stringify(dark)}`);
  return `{ ${fields.join(", ")} }`;
}

/** woowtech-vendor-mark-styles.gen.ts: how the app draws each mark that shows its logo. */
export function expectedMarkStylesSource() {
  const acp = [];
  const editors = [];
  const officialSvgs = [];
  for (const mark of Object.values(VENDOR_MARKS)) {
    if (mark.show === "badge") continue;
    for (const id of mark.acpIcons) {
      const own = mark.show === "official" ? officialAcpIcon(mark, id) : null;
      if (own) officialSvgs.push([id, `  ${propertyKey(id)}: ${JSON.stringify(own.light)},`]);
      acp.push([id, `  ${propertyKey(id)}: ${styleSource(mark, own?.dark)},`]);
    }
    for (const id of editorLogoIds(mark)) {
      editors.push([id, `  ${propertyKey(id)}: ${styleSource(mark)},`]);
    }
  }
  const sortedLines = (entries) =>
    entries.toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([, line]) => line);
  return [
    "// woowtech smart: how the app draws each vendor mark that shows the vendor's own logo, by ACP",
    "// icon id and by desktop editor id (woowtech/README.md section 25). Written by",
    "// woowtech/tools/write-vendor-badges.mjs from woowtech/vendor-marks.mjs; do not edit. A vendor",
    "// that shows its text badge has no entry: the badge draws in the colour its place gives it.",
    "",
    "/**",
    " * How a mark is coloured. theme: in the colour its place gives it (currentColor), the way the",
    " * ACP registry means its icons. mono: pure black on light themes and pure white on dark ones.",
    " * original: in its own colours. Where a place may dim or tint its icon, a mono or original",
    " * mark draws its badge instead.",
    " */",
    'export type VendorMarkColor = "theme" | "mono" | "original";',
    "",
    "export interface VendorMarkStyle {",
    "  readonly color: VendorMarkColor;",
    "  /** The mark may only appear beside its product's name; elsewhere its badge shows. */",
    "  readonly onlyBesideName?: true;",
    "  /** The vendor's own file for dark themes; the mark's own SVG is the one for light themes. */",
    "  readonly onDark?: string;",
    "}",
    "",
    "/** The vendors' own files that ACP icons draw on light themes, as downloaded. */",
    "export const OFFICIAL_ACP_ICON_SVGS = {",
    ...sortedLines(officialSvgs),
    "} as const;",
    "",
    "/** By ACP icon id (assets/acp-provider-icons.ts). */",
    "export const ACP_ICON_STYLES: Readonly<Record<string, VendorMarkStyle>> = {",
    ...sortedLines(acp),
    "};",
    "",
    '/** By desktop editor id, for the "Open in" button and menu. */',
    "export const EDITOR_ICON_STYLES: Readonly<Record<string, VendorMarkStyle>> = {",
    ...sortedLines(editors),
    "};",
    "",
  ].join("\n");
}

function matches(file, content) {
  const absolute = path.join(repoRoot, file);
  if (content === null) return !existsSync(absolute);
  return existsSync(absolute) && Buffer.compare(readFileSync(absolute), Buffer.from(content)) === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const expected = {
    ...expectedVendorFiles(),
    [ACP_ICONS_FILE]: expectedAcpIconsSource(),
    [MARK_STYLES_FILE]: expectedMarkStylesSource(),
  };
  const stale = Object.entries(expected).filter(([file, content]) => !matches(file, content));
  if (check) {
    if (stale.length > 0) {
      console.error(`Not as vendor-marks.mjs says:\n${stale.map(([file]) => file).join("\n")}`);
      process.exit(1);
    }
    console.log("Every vendor icon file is as vendor-marks.mjs says.");
  } else {
    for (const [file, content] of stale) {
      const absolute = path.join(repoRoot, file);
      if (content === null) {
        rmSync(absolute, { force: true });
      } else {
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
      }
    }
    console.log(`Rewrote ${stale.length} files.`);
  }
}
