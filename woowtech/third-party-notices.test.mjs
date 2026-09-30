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
// name a mark that does not ship. Stage 2 (section 25) restores vendors' logos under their rules;
// an owner that asks for a trademark line gets it on the page, in the form its rules give.
//
// The stage 1 review (2026-09-30) found places that broke those rules. They are closed:
//   - The app draws no lucide brand icon. Lucide redraws brands' logos as outline icons in the
//     caller's colour; the add-project flow drew its GitHub outline in muted grey.
//   - The pull request actions draw the generic pull request glyph for GitHub and Codeberg. The
//     actions dim when disabled or unavailable, which turns a black or white mark grey.
//   - Astro, Gradle, GraphQL and Lua also become the generic file icon: their owners forbid the
//     colour change or ask for permission first, as with the eight above. Per the owner, a mark
//     waits as a generic icon or badge until its owner agrees.
//
//   node --test woowtech/third-party-notices.test.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";
import { requireSource } from "./source-modules.mjs";
import { EDITOR_LOGO_DIR, shippedLogoFiles } from "./tools/write-vendor-badges.mjs";
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

// The file-type logos replaced with the generic file icon, with the extensions that showed them and
// the start of each logo's path data (compared with whitespace and commas removed). Research §2.4:
// B, their owners ask for permission, allow no commercial use, or forbid the colour changes
// file-icon-svg.ts makes. The owner replaced the first eight; the stage 1 review found the last four
// in the same group by their owners' own words (woowtech/README.md section 24).
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
  astro: {
    extensions: ["astro"],
    path: "M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18",
  },
  gradle: {
    extensions: ["gradle"],
    path: "M26 4h-2a4 4 0 0 0-4 4h4a1 1 0 0 1 2 0v4H16v-2h-5.317A2.683",
  },
  graphql: {
    extensions: ["graphql", "gql"],
    path: "M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382",
  },
  lua: {
    extensions: ["lua"],
    path: "M30 6a3.86 3.86 0 0 1-1.167 2.833 4.024 4.024 0 0 1-5.666 0A3.86",
  },
};

// The owners whose brand rules ask for a trademark line wherever their logo appears (research §3.4,
// point 4, and the vendors' pages under coord/brand-assets), by vendor in vendor-marks.mjs: the form
// of the line, and the site the rules ask the mark to link back to. A vendor here that shows its
// logo has that line as its credit on the notices page.
const jetBrains = (product) =>
  new RegExp(
    `^Copyright © \\d{4} JetBrains s\\.r\\.o\\. ${product} and the ${product} logo are trademarks of JetBrains s\\.r\\.o\\.$`,
  );
const googleLegalLine = /\bGoogle\b/; // Google's Legal line generator writes it (not yet obtained).
const TRADEMARK_LINES = {
  codex: { credit: /\bOpenAI\b/ }, // OpenAI: "acknowledge that it belongs to OpenAI".
  gemini: { credit: googleLegalLine },
  antigravity: { credit: googleLegalLine },
  "android-studio": { credit: googleLegalLine },
  junie: { credit: jetBrains("Junie"), link: "https://www.jetbrains.com" },
  webstorm: { credit: jetBrains("WebStorm"), link: "https://www.jetbrains.com" },
  vscode: {
    credit:
      /^Visual Studio Code, VS Code, and the Visual Studio Code icon are trademarks of Microsoft Corporation\. All rights reserved\.$/,
  },
};

const LUCIDE = "lucide-react-native";

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

/**
 * Lucide's brand icons, by every name lucide-react-native exports them under (Github, GithubIcon,
 * LucideGithub and so on), and the files it draws them in (github). Lucide's own type declarations
 * list them: it marks each one deprecated as one of its "Brand icons".
 */
function lucideBrandIcons() {
  const types = readFileSync(
    createRequire(path.join(repoRoot, "packages/app/package.json")).resolve(
      `${LUCIDE}/dist/lucide-react-native.d.ts`,
    ),
    "utf8",
  );
  const brands = new Set(
    [...types.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*declare const (\w+): LucideIcon;/g)]
      .filter(([, doc]) => doc.includes("Brand icons have been deprecated"))
      .map(([, , name]) => name),
  );
  assert.ok(brands.has("Github") && brands.has("Gitlab"), `${LUCIDE}'s brand icons not found`);
  const names = new Set(brands);
  const exported = /^export \{([^}]*)\};?$/m.exec(types)?.[1] ?? "";
  for (const entry of exported.split(",")) {
    const [name, alias] = entry.trim().split(/\s+as\s+/);
    if (alias && brands.has(name)) names.add(alias);
  }
  const files = new Set(
    [...brands].map((name) => name.replace(/(?<=[a-z\d])([A-Z])/g, "-$1").toLowerCase()),
  );
  return { names, files };
}

/**
 * Where the shipped app code draws a lucide brand icon, as "file: name": a named import or
 * re-export under any of the icon's names, a member of the whole library or of its `icons` object,
 * or an import of the icon's own file.
 */
function lucideBrandIconsDrawn() {
  const { names, files } = lucideBrandIcons();
  const drawn = [];
  for (const file of shippedSourceFiles(path.join(repoRoot, "packages/app/src"), /\.[jt]sx?$/)) {
    const source = readFileSync(file, "utf8");
    const draw = (name) => drawn.push(`${relative(file)}: ${name}`);
    const named =
      /(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']lucide-react-native["']/g;
    for (const [, list] of source.matchAll(named)) {
      for (const entry of list.split(",")) {
        const name = entry
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (names.has(name)) draw(name);
      }
    }
    const wholeLibrary = /import\s*\*\s*as\s+(\w+)\s+from\s*["']lucide-react-native["']/g;
    const iconsObject =
      /import\s*\{[^}]*\bicons(?:\s+as\s+(\w+))?\b[^}]*\}\s*from\s*["']lucide-react-native["']/g;
    const libraries = [
      ...[...source.matchAll(wholeLibrary)].map(([, local]) => local),
      ...[...source.matchAll(iconsObject)].map(([, local]) => local ?? "icons"),
    ];
    for (const library of libraries) {
      const member = new RegExp(
        `\\b${library}\\s*(?:\\.\\s*(\\w+)|\\[\\s*["'](\\w+)["']\\s*\\])`,
        "g",
      );
      for (const [, dotted, indexed] of source.matchAll(member)) {
        if (names.has(dotted ?? indexed)) draw(dotted ?? indexed);
      }
    }
    for (const [, iconFile] of source.matchAll(
      /["']lucide-react-native\/[^"']*\/([\w-]+?)(?:\.js)?["']/g,
    )) {
      if (files.has(iconFile)) draw(iconFile);
    }
  }
  return drawn;
}

function* shippedFiles() {
  for (const dir of SHIPPED_DIRS) {
    yield* shippedSourceFiles(path.join(repoRoot, dir), SHIPPED_FILES);
  }
}

/**
 * The vendors that show their own logo (woowtech/vendor-marks.mjs): as an agent's icon, in the app,
 * and as an editor's icon, in the desktop app's "Open in" menu.
 */
function vendorsShowingTheirLogo() {
  const agents = [];
  const editors = [];
  for (const [vendor, mark] of Object.entries(VENDOR_MARKS)) {
    if (mark.show === "badge") continue;
    const files = shippedLogoFiles(mark);
    if (mark.acpIcons.length > 0 || files.some((file) => file.startsWith("packages/app/"))) {
      agents.push(vendor);
    }
    if (files.some((file) => file.startsWith(`${EDITOR_LOGO_DIR}/`))) editors.push(vendor);
  }
  return { agents, editors };
}

test("every agent and editor that shows its own logo has an entry on the notices page, and no other", () => {
  const { VENDOR_MARK_NOTICES, EDITOR_MARK_NOTICES } = notices();
  const { agents, editors } = vendorsShowingTheirLogo();
  assert.deepEqual(
    sorted(Object.keys(VENDOR_MARK_NOTICES)),
    sorted(agents),
    `Give each agent that shows its own logo in woowtech/vendor-marks.mjs an entry in ${NOTICES_FILE}'s VENDOR_MARK_NOTICES, and remove the entries of vendors that show their badge.`,
  );
  assert.deepEqual(
    sorted(Object.keys(EDITOR_MARK_NOTICES ?? {})),
    sorted(editors),
    `Give each editor that shows its own logo in woowtech/vendor-marks.mjs an entry in ${NOTICES_FILE}'s EDITOR_MARK_NOTICES, and remove the others.`,
  );
});

test("an owner that asks for a trademark line has it on the notices page, as its rules write it", () => {
  const { VENDOR_MARK_NOTICES, EDITOR_MARK_NOTICES } = notices();
  const entries = { ...EDITOR_MARK_NOTICES, ...VENDOR_MARK_NOTICES };
  const { agents, editors } = vendorsShowingTheirLogo();
  const missing = [...new Set([...agents, ...editors])]
    .filter((vendor) => vendor in TRADEMARK_LINES)
    .flatMap((vendor) => {
      const line = TRADEMARK_LINES[vendor];
      const notice = entries[vendor] ?? {};
      const problems = [];
      if (!line.credit.test(notice.credit ?? ""))
        problems.push(`${vendor}: credit "${notice.credit}"`);
      if (line.link && notice.link !== line.link) problems.push(`${vendor}: link "${notice.link}"`);
      return problems;
    });
  assert.deepEqual(
    missing,
    [],
    "Add the trademark line the owner's brand rules ask for (research §3.4, point 4).",
  );
});

test("every forge mark the app draws has an entry on the notices page, and no other", () => {
  assert.deepEqual(
    sorted(Object.keys(notices().FORGE_MARK_NOTICES)),
    sorted(forgesShowingTheirMark()),
    `Give each forge that draws its own mark an entry in ${NOTICES_FILE}, and remove the others.`,
  );
});

test("the app draws no lucide brand icon, under any of its names", () => {
  assert.deepEqual(
    lucideBrandIconsDrawn(),
    [],
    "A lucide brand icon ships. Lucide redraws the brand's logo as an outline in the caller's " +
      "colour, which the brands' rules do not allow: GitHub asks for its own mark in black or " +
      "white, GitLab allows no logo. Draw a forge's mark from components/icons where its name " +
      "stands next to it, or use a generic icon.",
  );
});

test("every entry under an attribution license names its credit, license and source", () => {
  const { EDITOR_MARK_NOTICES, FILE_TYPE_MARK_NOTICES, FORGE_MARK_NOTICES, VENDOR_MARK_NOTICES } =
    notices();
  const entries = [
    ...Object.entries(VENDOR_MARK_NOTICES),
    ...Object.entries(EDITOR_MARK_NOTICES ?? {}),
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

test("the pull request actions, which dim, draw the generic glyph for GitHub and Codeberg", () => {
  const actions = read("packages/app/src/git/use-actions.tsx");
  const has = (pattern) => pattern.test(actions);
  assert.ok(
    has(/import \{ dimmableForgeIconKind \} from "@\/git\/woowtech-forge-marks";/),
    "use-actions.tsx does not import dimmableForgeIconKind",
  );
  const render =
    /\nfunction renderForgePrIcon\(forge: Forge\): ReactElement \{\n([\s\S]*?)\n\}\n/.exec(
      actions,
    )?.[1];
  assert.ok(render, "renderForgePrIcon not found in use-actions.tsx");
  assert.ok(
    /const icon = dimmableForgeIconKind\(getForgePresentation\(forge\)\.icon\);/.test(render),
    "The pull request actions draw the forge's mark as it is, so GitHub's and Codeberg's dim grey.",
  );
  assert.ok(
    has(/const prIcon = useMemo\(\(\) => renderForgePrIcon\(forge\), \[forge\]\);/),
    "The change-request actions no longer share the icon renderForgePrIcon makes.",
  );
  // The fork module goes by the mark itself: any mark made to stay pure black or white.
  assert.ok(
    /isMonochromeMarkIcon\(getForgeIconComponent\(iconKind\)\)/.test(
      read("packages/app/src/git/woowtech-forge-marks.ts"),
    ),
    "woowtech-forge-marks.ts does not ask whether the forge's mark is a monochrome mark",
  );
});

test("the twelve replaced file-type logos ship nowhere and their files show the generic icon", () => {
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
  assert.equal(icons.length, 42, "the file-type icon table no longer has the 42 icons that stay");
});
