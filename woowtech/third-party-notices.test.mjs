// woowtech smart's launch compliance for third-party marks (woowtech/README.md section 24). On
// 2026-09-30 the owner decided, from coord/reports/logo-usage-research.md:
//   - Settings has a page, 商標與第三方授權 (Trademarks and third-party notices), that lists every
//     third-party mark the app shows with its owner and the credit or license its owner asks for.
//   - GitLab's forge mark becomes the neutral text badge: GitLab's guidelines permit its name but
//     not its logo.
//   - GitHub and Codeberg draw their marks in pure black or white, never tinted.
//   - Eight file-type logos become the generic file icon: Go, Swift, Terraform and HCL, Vue, Sass,
//     Dart and Elixir.
// The list of marks that ship comes from woowtech/vendor-marks.mjs, the forge views and the
// file-type icon table, so a mark cannot ship without its entry on the page, and the page cannot
// name a mark that does not ship.
//
//   node --test woowtech/third-party-notices.test.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";
import { requireSource } from "./source-modules.mjs";
import { VENDOR_MARKS } from "./vendor-marks.mjs";

const NOTICES_FILE = "packages/app/src/screens/settings/woowtech-third-party-notices.ts";
const NOTICES_PAGE = "packages/app/src/screens/settings/woowtech-third-party-notices-section.tsx";
const FILE_ICONS = "packages/app/src/components/material-file-icons.ts";
const FORGE_VIEWS = "packages/app/src/git/forges";
const ICONS = "packages/app/src/components/icons";
const SHIPPED_DIRS = [
  "packages/app/src",
  "packages/app/assets",
  "packages/app/public",
  "packages/app/plugins",
  "packages/desktop/src",
  "packages/desktop/assets",
  "packages/server/src",
  "packages/cli/src",
];
const SHIPPED_FILES = /\.(?:[cm]?[jt]sx?|json|svg|html|css|xml)$/;

// The file-type logos the owner replaced with the generic file icon, with the extensions that
// showed them and the start of each logo's path data (compared with whitespace and commas
// removed). Research §2.4: B, their owners ask for permission, allow no commercial use, or forbid
// the colour changes file-icon-svg.ts makes.
const REPLACED_FILE_TYPE_LOGOS = {
  go: { extensions: ["go"], path: "M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42" },
  swift: {
    extensions: ["swift"],
    path: "M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.",
  },
  terraform: {
    extensions: ["tf"],
    path: "m2 10 8 4V6L2 2zm10 5 8 4v-8l-8-4zm0 11 8 4v-8l-8-4zm10-14v8",
  },
  hcl: { extensions: ["hcl"], path: "M18 1.2V14h-4v-4l-4 2v16.37l4 2.43V18h4v4l4-2V3.63z" },
  vue: {
    extensions: ["vue"],
    path: "M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L",
  },
  sass: {
    extensions: ["scss"],
    path: "M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-",
  },
  dart: {
    extensions: ["dart"],
    path: "M16.83 2a1.3 1.3 0 0 0-.916.377l-.013.01L7.323 7.34l8.556 8.",
  },
  elixir: {
    extensions: ["ex", "exs"],
    path: "M12.173 22.681c-3.86 0-6.99-3.64-6.99-8.13 0-3.678 2.773-8.1",
  },
};

// Lucide's brand icons, by the notice that covers the brand. Lucide draws them from the brands'
// logos, so using one in the app shows that brand's mark.
const LUCIDE_BRAND_ICONS = {
  Chrome: "chrome",
  Chromium: "chromium",
  Codepen: "codepen",
  Codesandbox: "codesandbox",
  Dribbble: "dribbble",
  Facebook: "facebook",
  Figma: "figma",
  Framer: "framer",
  Github: "github",
  Gitlab: "gitlab",
  Instagram: "instagram",
  Linkedin: "linkedin",
  Pocket: "pocket",
  Slack: "slack",
  Trello: "trello",
  Twitch: "twitch",
  Twitter: "twitter",
  Youtube: "youtube",
};

const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");
const relative = (file) => path.relative(repoRoot, file);
const squeeze = (text) => text.replace(/[\s,]+/g, "");
const sorted = (values) => [...values].sort();

function notices() {
  return requireSource(NOTICES_FILE);
}

/** The icon names and extension mappings of the file-type icon table. */
function fileIconTable() {
  const source = read(FILE_ICONS);
  const icons = [...source.matchAll(/^ {2}"?([\w]+)"?: `<svg/gm)].map((match) => match[1]);
  const extensionBlock = /const EXTENSION_TO_ICON[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
  const extensions = Object.fromEntries(
    [...extensionBlock.matchAll(/^ {2}"?([\w.]+)"?: "([\w]+)",/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  assert.ok(icons.length > 0 && Object.keys(extensions).length > 0, `${FILE_ICONS} not parsed`);
  return { icons, extensions };
}

/** The forges the app draws with their own mark: every forge view whose icon is not a badge. */
function forgesShowingTheirMark() {
  const shown = [];
  for (const name of readdirSync(path.join(repoRoot, FORGE_VIEWS))) {
    if (!name.endsWith(".view.tsx")) continue;
    const view = read(`${FORGE_VIEWS}/${name}`);
    const forge = /\bid: "([\w-]+)"/.exec(view)?.[1];
    const icon = /\bicon: (\w+),/.exec(view)?.[1];
    assert.ok(forge && icon, `${FORGE_VIEWS}/${name}: no id or icon`);
    const from = new RegExp(
      `import \\{[^}]*\\b${icon}\\b[^}]*\\} from "@/components/icons/([\\w-]+)"`,
    ).exec(view)?.[1];
    assert.ok(from, `${FORGE_VIEWS}/${name}: ${icon} is not imported from components/icons`);
    if (!read(`${ICONS}/${from}.tsx`).includes("createVendorBadgeIcon(")) shown.push(forge);
  }
  return shown;
}

/** Lucide brand icons the shipped app code imports, as the notice keys of their brands. */
function lucideBrandsShown() {
  const brands = new Set();
  for (const file of shippedSourceFiles(path.join(repoRoot, "packages/app/src"), /\.[jt]sx?$/)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react-native"/g)) {
      for (const imported of match[1].split(",")) {
        const name = imported.trim().split(/\s+as\s+/)[0];
        if (name in LUCIDE_BRAND_ICONS) brands.add(LUCIDE_BRAND_ICONS[name]);
      }
    }
  }
  return [...brands];
}

function* shippedFiles() {
  for (const dir of SHIPPED_DIRS) {
    yield* shippedSourceFiles(path.join(repoRoot, dir), SHIPPED_FILES);
  }
}

test("every agent that shows its own logo has an entry on the notices page, and no other", () => {
  const showingLogo = Object.entries(VENDOR_MARKS)
    .filter(([, mark]) => mark.show === "upstream")
    .map(([vendor]) => vendor);
  assert.deepEqual(
    sorted(Object.keys(notices().VENDOR_MARK_NOTICES)),
    sorted(showingLogo),
    `Give each vendor with show: "upstream" in woowtech/vendor-marks.mjs an entry in ${NOTICES_FILE}, and remove the entries of vendors that show their badge.`,
  );
});

test("every forge mark the app draws has an entry on the notices page, and no other", () => {
  assert.deepEqual(
    sorted(Object.keys(notices().FORGE_MARK_NOTICES)),
    sorted(forgesShowingTheirMark()),
    `Give each forge that draws its own mark an entry in ${NOTICES_FILE}, and remove the others.`,
  );
});

test("the app draws no lucide brand icon whose brand has no entry, so never GitLab's", () => {
  const { FORGE_MARK_NOTICES } = notices();
  assert.deepEqual(
    lucideBrandsShown().filter((brand) => !(brand in FORGE_MARK_NOTICES)),
    [],
    "A lucide brand icon ships. Decide whether its brand's logo may show, first.",
  );
});

test("every entry under an attribution license names its credit, license and source", () => {
  const { FILE_TYPE_MARK_NOTICES, FORGE_MARK_NOTICES, VENDOR_MARK_NOTICES } = notices();
  const entries = [
    ...Object.entries(VENDOR_MARK_NOTICES),
    ...Object.entries(FORGE_MARK_NOTICES),
    ...FILE_TYPE_MARK_NOTICES.map((notice) => [notice.icons[0], notice]),
  ];
  const incomplete = entries
    .filter(([, notice]) => (notice.license?.name ?? "").startsWith("CC BY"))
    .filter(([, notice]) => !notice.credit || !notice.source || !notice.license.url)
    .map(([key]) => key);
  assert.deepEqual(
    incomplete,
    [],
    "A Creative Commons BY work needs its credit, license link and source.",
  );
  const unnamed = entries.filter(([, notice]) => !notice.name || !notice.owner).map(([key]) => key);
  assert.deepEqual(unnamed, [], "Every entry names the mark and its owner.");
});

test("every file-type logo the app draws has an entry on the notices page, and no other", () => {
  const { FILE_TYPE_MARK_NOTICES, GENERIC_FILE_ICONS } = notices();
  const { icons } = fileIconTable();
  const noticed = FILE_TYPE_MARK_NOTICES.flatMap((notice) => notice.icons);
  const logos = icons.filter((icon) => !GENERIC_FILE_ICONS.includes(icon));
  assert.deepEqual(
    sorted(noticed),
    sorted(logos),
    `Give each file-type icon that draws a logo an entry in ${NOTICES_FILE}, or list it as generic.`,
  );
  assert.deepEqual(
    GENERIC_FILE_ICONS.filter((icon) => !icons.includes(icon)),
    [],
    `${NOTICES_FILE} lists generic icons the table no longer has.`,
  );
  assert.deepEqual(
    noticed.filter((icon, index) => noticed.indexOf(icon) !== index),
    [],
    "An icon has two entries.",
  );
});

test("the notices page carries material-icon-theme's copyright line and MIT notice", () => {
  const { MIT_LICENSE_TEXT, MIT_NOTICES } = notices();
  const license = readFileSync(
    createRequire(path.join(repoRoot, "packages/app/package.json")).resolve(
      "material-icon-theme/LICENSE",
    ),
    "utf8",
  );
  const [header, ...body] = license.split(/\n\s*\n/);
  const iconSet = MIT_NOTICES.find((notice) => notice.work === "material-icon-theme");
  assert.ok(iconSet, "material-icon-theme is missing from MIT_NOTICES");
  for (const line of iconSet.copyright) {
    assert.ok(header.includes(line), `material-icon-theme's LICENSE no longer says "${line}"`);
  }
  assert.equal(squeeze(MIT_LICENSE_TEXT), squeeze(body.join("\n\n")));
});

test("Settings opens the notices page at /settings/notices on every platform", () => {
  assert.match(
    read("packages/app/src/utils/host-routes.ts"),
    /export const SETTINGS_SECTION_SLUGS = \[[^\]]*"notices",[^\]]*\] as const;/,
  );
  const settings = read("packages/app/src/screens/settings-screen.tsx");
  const item = /\{\s*id: "notices",[^}]*\}/.exec(settings)?.[0] ?? "";
  assert.match(item, /labelKey: "woowtech\.thirdPartyNotices\.title"/);
  assert.doesNotMatch(item, /desktopOnly|webOnly/, "the page is not limited to one platform");
  // The section switch hands the sections it has no case for to the fork, which renders notices.
  assert.match(settings, /default:\s*return renderWoowtechSettingsSection\(view\.section\);/);
  const page = read(NOTICES_PAGE);
  assert.match(page, /section === "notices" \? <ThirdPartyNoticesSection \/> : null/);
  assert.match(page, /buildThirdPartyNotices\(t\)/);
});

test("GitLab's forge mark is the text badge, in the caller's colour", () => {
  assert.equal(
    VENDOR_MARKS.gitlab?.show,
    "badge",
    "GitLab shows its badge (woowtech/vendor-marks.mjs)",
  );
  assert.match(read(`${ICONS}/gitlab-icon.tsx`), /createVendorBadgeIcon\("gitlab"\)/);
  assert.match(read(`${FORGE_VIEWS}/gitlab.view.tsx`), /\bbrandColor: null,/);
  const tanuki = squeeze(VENDOR_MARKS.gitlab.logoPaths[0] ?? "");
  assert.ok(tanuki.length > 20, "the tanuki's path data is missing from vendor-marks.mjs");
  const drawing = [...shippedFiles()]
    .filter((file) => squeeze(readFileSync(file, "utf8")).includes(tanuki))
    .map(relative);
  assert.deepEqual(drawing, [], "The GitLab tanuki ships; show the text badge instead.");
});

test("GitHub and Codeberg draw their marks in pure black or white, never tinted", () => {
  const mark = read(`${ICONS}/woowtech-monochrome-mark.tsx`);
  assert.match(mark, /colorScheme === "light" \? "#000000" : "#FFFFFF"/);
  for (const forge of ["github", "codeberg"]) {
    const icon = read(`${ICONS}/${forge}-icon.tsx`);
    assert.match(icon, /= createMonochromeMarkIcon\(\{/, `${forge}-icon.tsx draws a tinted mark`);
    assert.doesNotMatch(icon, /\bcolor\b/, `${forge}-icon.tsx takes a colour`);
    assert.match(read(`${FORGE_VIEWS}/${forge}.view.tsx`), /\bbrandColor: null,/);
  }
});

test("the eight replaced file-type logos ship nowhere and their files show the generic icon", () => {
  const { icons, extensions } = fileIconTable();
  assert.deepEqual(
    Object.keys(REPLACED_FILE_TYPE_LOGOS).filter((icon) => icons.includes(icon)),
    [],
    "A replaced logo is back in the file-type icon table.",
  );
  assert.deepEqual(
    Object.values(REPLACED_FILE_TYPE_LOGOS)
      .flatMap((logo) => logo.extensions)
      .filter((extension) => extension in extensions),
    [],
    "A replaced logo's extension maps to an icon; it should fall back to the generic file icon.",
  );
  const logos = Object.entries(REPLACED_FILE_TYPE_LOGOS).map(([icon, logo]) => [
    icon,
    squeeze(logo.path),
  ]);
  const drawing = [];
  for (const file of shippedFiles()) {
    const text = squeeze(readFileSync(file, "utf8"));
    for (const [icon, pathData] of logos) {
      if (text.includes(pathData)) drawing.push(`${relative(file)}: ${icon}`);
    }
  }
  assert.deepEqual(drawing, [], "A replaced file-type logo ships.");
  assert.equal(
    icons.length,
    46,
    "the file-type icon table no longer has the 46 icons the owner kept",
  );
});
