// Applies woowtech/vendor-marks.mjs to the vendor icon files the app and the desktop app ship.
// A vendor that shows its badge gets the badge in its icon component, its vendored SVGs and its
// entries in acp-provider-icons.ts, and its desktop PNG removed. A vendor that shows its upstream
// logo gets its files and entries back exactly as they were at UPSTREAM_REF.
// woowtech/README.md section 22.
//
//   node woowtech/tools/write-vendor-badges.mjs           # write the files
//   node woowtech/tools/write-vendor-badges.mjs --check   # fail when a file does not match
//
// Re-run after changing vendor-marks.mjs or the badge, or after an upstream merge adds a vendor
// icon: woowtech/claude-badge.test.mjs fails until the files match.
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

const ACP_KEY = /^ {2}("?)([a-z0-9-]+)\1:/;

/** A file as it was at UPSTREAM_REF. */
export function upstreamFile(file) {
  return execFileSync("git", ["show", `${UPSTREAM_REF}:${file}`], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
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

/**
 * What each vendor icon file must hold, by its path in the repo: the badge or the upstream file
 * (text or bytes), or null for a desktop logo that must not ship.
 */
export function expectedVendorFiles() {
  const { vendorBadgeSvg } = requireSource("packages/app/src/components/icons/vendor-badge.ts");
  const expected = {};
  for (const mark of Object.values(VENDOR_MARKS)) {
    for (const file of mark.files) {
      if (mark.show === "upstream") {
        expected[file] = upstreamFile(file);
      } else if (file.endsWith("-icon.tsx")) {
        expected[file] = badgeComponent(file, mark.logo);
      } else if (file.endsWith(".svg")) {
        expected[file] = vendorBadgeSvg(path.basename(file, ".svg"));
      } else {
        expected[file] = null;
      }
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
  const lines = [...current.keys()].flatMap((id) => {
    const mark = vendorByIcon.get(id);
    if (!mark) throw new Error(`${ACP_ICONS_FILE}: add "${id}" to a vendor in vendor-marks.mjs`);
    if (mark.show === "upstream") {
      const entry = upstream.get(id);
      if (!entry)
        throw new Error(`${ACP_ICONS_FILE}: "${id}" has no upstream icon at ${UPSTREAM_REF}`);
      return entry;
    }
    badges += 1;
    const key = /^[a-z_$][\w$]*$/i.test(id) ? id : `"${id}"`;
    return [`  ${key}: vendorBadgeSvg("${id}"),`];
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
    "export const ACP_PROVIDER_ICON_SVGS = {",
    ...lines,
    "} as const;",
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
  const expected = { ...expectedVendorFiles(), [ACP_ICONS_FILE]: expectedAcpIconsSource() };
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
