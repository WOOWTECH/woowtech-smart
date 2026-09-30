// woowtech smart shows some vendors' own logos again, each only where the app meets its
// conditions (woowtech/README.md section 25). On 2026-09-30 the owner cleared the 14 vendors whose
// brand rules allow their logo, once the app meets those rules; the research is
// coord/reports/logo-usage-research.md and the vendors' files were collected under
// coord/brand-assets (both outside the repo). Until a vendor's conditions hold, it keeps the text
// badge; one data line in woowtech/vendor-marks.mjs switches it back.
//
// This checks the data and what the tool writes from it:
//   - how each logo is coloured (theme, mono or original), and an unknown value fails;
//   - a vendor's own files are committed as downloaded, with where and when they came from, and
//     the app ships them byte for byte;
//   - the app knows how to draw each mark (woowtech-vendor-mark-styles.gen.ts);
//   - a mark whose owner or the research asks for its product's name beside it only ever
//     appears there: Google's, Microsoft's, Junie's and Zed's;
//   - the places that draw provider marks and the desktop "Open in" button are wired to that.
// What the app draws, per theme and state, is pinned by the app's vitest suites
// (woowtech-vendor-mark-icon.test.ts, woowtech-editor-marks.test.ts), and the desktop "Open in"
// button in the workspace header by the desktop renderer's
// e2e/woowtech-open-in-editor-marks.spec.ts.
//
//   node --test woowtech/vendor-logos.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";
import { requireSource } from "./source-modules.mjs";
import {
  ACP_ICONS_FILE,
  EDITOR_LOGO_DIR,
  MARK_STYLES_FILE,
  expectedMarkStylesSource,
  shippedLogoFiles,
} from "./tools/write-vendor-badges.mjs";
import { VENDOR_MARKS } from "./vendor-marks.mjs";

const SHOWS = new Set(["badge", "upstream", "official"]);
const COLORS = new Set(["theme", "mono", "original"]);
const FIELDS = new Set([
  "show",
  "logo",
  "color",
  "official",
  "badgeFiles",
  "onlyBesideName",
  "files",
  "acpIcons",
  "logoPaths",
]);
// Google asks that its product icons never stand on their own ("Don't use product icons by
// themselves"); Microsoft's buttons read "Open in VS Code" (research §3.4, point 1). The research
// restores Junie's and Zed's icons with the name Junie or Zed beside them (§2.2, §2.3).
const ONLY_BESIDE_THEIR_NAME = [
  "gemini",
  "antigravity",
  "android-studio",
  "vscode",
  "junie",
  "zed",
];

const marks = Object.entries(VENDOR_MARKS);
const showingLogo = marks.filter(([, mark]) => mark.show !== "badge");
const official = marks.filter(([, mark]) => mark.show === "official");

const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");
const sha256 = (file) =>
  createHash("sha256")
    .update(readFileSync(path.join(repoRoot, file)))
    .digest("hex");

function manifestOf(mark) {
  return JSON.parse(read(mark.official.manifest));
}

/** Each official file of `mark`, as [where the app ships it, the vendor's file in the repo]. */
function officialCopies(mark) {
  return [
    ...Object.entries(mark.official.files ?? {}),
    ...Object.entries(mark.official.acpIcons ?? {}).flatMap(([id, files]) =>
      Object.entries(files).map(([theme, file]) => [`${ACP_ICONS_FILE} ${id} (${theme})`, file]),
    ),
  ];
}

test("every vendor mark says how it shows, in values the tool knows", () => {
  const problems = [];
  for (const [vendor, mark] of marks) {
    const unknown = Object.keys(mark).filter((field) => !FIELDS.has(field));
    if (unknown.length > 0) problems.push(`${vendor}: unknown fields ${unknown.join(", ")}`);
    if (!SHOWS.has(mark.show)) problems.push(`${vendor}: show "${mark.show}"`);
    if (mark.show !== "badge" && !COLORS.has(mark.color)) {
      problems.push(`${vendor}: shows its logo with color "${mark.color}"`);
    }
    if (mark.show === "badge" && mark.color !== undefined) {
      problems.push(`${vendor}: shows its badge but names a color`);
    }
    if ((mark.show === "official") !== (mark.official !== undefined)) {
      problems.push(`${vendor}: official files go with show "official" and only with it`);
    }
    if (![undefined, true].includes(mark.onlyBesideName)) {
      problems.push(`${vendor}: onlyBesideName is ${mark.onlyBesideName}`);
    }
    for (const file of mark.badgeFiles ?? []) {
      if (!mark.files.includes(file)) problems.push(`${vendor}: badge file ${file} is not its own`);
    }
    if (mark.badgeFiles && mark.show === "badge") {
      problems.push(`${vendor}: every file of a vendor that shows its badge is a badge`);
    }
    // The desktop app draws an editor's logo as an image, which it cannot recolour.
    const editorLogos = shippedLogoFiles(mark).filter((file) =>
      file.startsWith(`${EDITOR_LOGO_DIR}/`),
    );
    if (editorLogos.length > 0 && mark.color !== "original") {
      problems.push(`${vendor}: an editor's logo shows in its own colours, color "original"`);
    }
  }
  assert.deepEqual(problems, []);
});

test("a vendor's own files are committed as downloaded, with where and when they came from", () => {
  assert.ok(official.length > 0, "no vendor shows its own files");
  const problems = [];
  for (const [vendor, mark] of official) {
    const manifest = manifestOf(mark);
    const dir = path.dirname(mark.official.manifest);
    const listed = new Map(manifest.files.map((entry) => [path.join(dir, entry.file), entry]));
    for (const [, file] of officialCopies(mark)) {
      const entry = listed.get(file);
      if (!entry) {
        problems.push(`${vendor}: ${file} is not in ${mark.official.manifest}`);
        continue;
      }
      if (entry.sha256 !== sha256(file)) problems.push(`${vendor}: ${file} is not as downloaded`);
      if (!/^https:\/\/\S+$/.test(entry.source)) problems.push(`${vendor}: ${file} has no source`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.retrieved ?? "")) {
        problems.push(`${vendor}: ${file} has no retrieval date`);
      }
    }
    if (manifest.vendor !== vendor)
      problems.push(`${vendor}: the manifest is ${manifest.vendor}'s`);
  }
  assert.deepEqual(problems, []);
});

test("the app ships a vendor's own files byte for byte", () => {
  const { ACP_PROVIDER_ICON_SVGS } = requireSource(ACP_ICONS_FILE);
  const { ACP_ICON_STYLES } = requireSource(MARK_STYLES_FILE);
  const differing = [];
  for (const [vendor, mark] of official) {
    for (const [shipped, file] of Object.entries(mark.official.files ?? {})) {
      const absolute = path.join(repoRoot, shipped);
      if (!existsSync(absolute) || sha256(shipped) !== sha256(file)) differing.push(shipped);
    }
    for (const [id, files] of Object.entries(mark.official.acpIcons ?? {})) {
      if (ACP_PROVIDER_ICON_SVGS[id] !== read(files.light)) differing.push(`${vendor}: ${id}`);
      if (files.dark !== undefined && ACP_ICON_STYLES[id]?.onDark !== read(files.dark)) {
        differing.push(`${vendor}: ${id} on dark themes`);
      }
    }
  }
  assert.deepEqual(differing, [], "Run node woowtech/tools/write-vendor-badges.mjs.");
});

test("the app knows how to draw each vendor mark that shows its logo", () => {
  assert.equal(read(MARK_STYLES_FILE), expectedMarkStylesSource());
  const { ACP_ICON_STYLES, EDITOR_ICON_STYLES } = requireSource(MARK_STYLES_FILE);
  const editorIds = (mark) =>
    mark.files
      .filter((file) => file.startsWith(`${EDITOR_LOGO_DIR}/`))
      .concat(Object.keys(mark.official?.files ?? {}))
      .filter((file) => !(mark.badgeFiles ?? []).includes(file))
      .map((file) => path.basename(file).replace(/\.(?:png|svg)$/, ""));
  const expectedAcp = {};
  const expectedEditors = {};
  for (const [, mark] of showingLogo) {
    for (const id of mark.acpIcons) expectedAcp[id] = mark.color;
    for (const id of editorIds(mark)) expectedEditors[id] = mark.color;
  }
  const colors = (styles) =>
    Object.fromEntries(Object.entries(styles).map(([id, style]) => [id, style.color]));
  assert.deepEqual(colors(ACP_ICON_STYLES), expectedAcp);
  assert.deepEqual(colors(EDITOR_ICON_STYLES), expectedEditors);
});

test("Google's, Microsoft's, Junie's and Zed's marks may only appear beside their product's name", () => {
  assert.deepEqual(
    ONLY_BESIDE_THEIR_NAME.filter((vendor) => VENDOR_MARKS[vendor]?.onlyBesideName !== true),
    [],
  );
  const { ACP_ICON_STYLES, EDITOR_ICON_STYLES } = requireSource(MARK_STYLES_FILE);
  const styled = { ...ACP_ICON_STYLES, ...EDITOR_ICON_STYLES };
  const loose = ONLY_BESIDE_THEIR_NAME.flatMap((vendor) => {
    const mark = VENDOR_MARKS[vendor];
    const ids = [
      ...mark.acpIcons,
      ...mark.files.map((file) => path.basename(file).replace(/\.(?:png|svg)$/, "")),
    ];
    return ids.filter((id) => id in styled && styled[id].onlyBesideName !== true);
  });
  assert.deepEqual(loose, []);
});

test("only the settings provider list and the ACP catalog draw a provider mark with conditions", () => {
  // getProviderIcon draws at a place it knows nothing about unless told: no name beside the icon,
  // and a state that may dim it. There a mono or original mark, or one that may only appear beside
  // its name, draws its badge. Only the places checked to name the provider beside a mark they
  // never dim say so, and a new one has to be checked first.
  const providerIcons = read("packages/app/src/components/provider-icons.ts");
  assert.match(
    providerIcons,
    /export function getProviderIcon\(\s*provider: string,\s*serverId\?: string \| null,[\s\S]*?place: VendorMarkPlace = UNCHECKED_PLACE,\s*\): ProviderIconComponent \{/,
  );
  assert.match(providerIcons, /return getCatalogProviderIcon\(name\.id, place\);/);
  const naming = [...shippedSourceFiles(path.join(repoRoot, "packages/app/src"), /\.[jt]sx?$/)]
    .map((file) => path.relative(repoRoot, file))
    .filter((file) => !file.includes("/icons/woowtech-vendor-mark-"))
    .filter((file) => /\bNAMED_ROW\b/.test(read(file)));
  assert.deepEqual(naming.sort(), [
    "packages/app/src/components/provider-catalog-list.tsx",
    "packages/app/src/screens/settings/providers-section.tsx",
  ]);
  assert.match(
    read("packages/app/src/screens/settings/providers-section.tsx"),
    /getProviderIcon\(def\.id, serverId, NAMED_ROW\)/,
  );
  const catalog = read("packages/app/src/components/provider-catalog-list.tsx");
  assert.match(catalog, /getProviderIcon\(provider, null, NAMED_ROW\)/);
  assert.doesNotMatch(catalog, /\bSvgXml\b/, "the ACP catalog draws the entry's SVG as it is");
});

test("the desktop Open in button names its target and draws no mark alone that needs its name", () => {
  // A tripwire for the wiring only: e2e/woowtech-open-in-editor-marks.spec.ts in the desktop
  // package checks what the header and the menu draw. Each element is tied to its field, so that
  // swapping the two, which leaves every line in place, turns this red too.
  const button = read("packages/app/src/workspace/open-in-editor/button.tsx");
  assert.match(button, /t\("woowtech\.openInEditor\.openIn", \{ target: primaryOption\.label \}\)/);
  assert.doesNotMatch(button, /t\("workspace\.git\.openInEditor\.open"\)/);
  assert.match(button, /\{hideLabels \? primaryOption\.iconAlone : primaryOption\.icon\}/);
  assert.match(button, /\bicon: \(\s*<ThemedEditorTargetIcon icon=\{target\.icon\} size=\{16\}/);
  assert.match(
    button,
    /\biconAlone: \(\s*<ThemedEditorTargetIcon\s+icon=\{editorIconAlone\(target\)\}\s+size=\{16\}/,
  );
  assert.match(button, /\bleading=\{target\.icon\}/, "the menu names each editor beside its icon");
});
