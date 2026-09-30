// woowtech smart shows third-party vendors as a neutral text badge, a monogram of the vendor's
// name in the caller's color inside a rounded square, instead of the vendor's logo. Anthropic's
// terms let a product name Claude Code in plain text, but using its logo takes written
// permission; the owner chose the Claude badge on 2026-09-27 and the same badge for every vendor
// on 2026-09-29. Which vendor shows its badge and which its upstream logo (after the owner clears
// it) is data in woowtech/vendor-marks.mjs; the checks here follow it. GitLab's forge mark is in
// that data too and shows its badge; the other git forges (GitHub, Gitea, Forgejo, Codeberg) keep
// their marks (section 24, woowtech/third-party-notices.test.mjs). No feature is named after
// Claude: the Claude theme is called 陶土 (Terracotta).
//
// An upstream merge can bring a logo back as a vendored ACP icon, a copied SVG, a new icon
// component, a bundled image or a new place that renders a host's SVG, so this scans what ships
// in the app, its web page, the desktop app, the daemon and the CLI. woowtech/README.md section 22.
//
//   node --test woowtech/claude-badge.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";
import { importSource, requireSource } from "./source-modules.mjs";
import {
  ACP_ICONS_FILE,
  EDITOR_LOGO_DIR,
  VENDOR_SVG_DIRS,
  expectedAcpIconsSource,
  expectedVendorFiles,
} from "./tools/write-vendor-badges.mjs";
import { VENDOR_MARKS } from "./vendor-marks.mjs";

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
const IMAGE_FILES = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|ico|icns|svg)$/i;

const marks = Object.entries(VENDOR_MARKS);
const showingBadge = marks.filter(([, mark]) => mark.show === "badge");
const showingUpstream = marks.filter(([, mark]) => mark.show === "upstream");
const upstreamFiles = showingUpstream.flatMap(([, mark]) => mark.files);
const claudeShowsItsBadge = VENDOR_MARKS.claude.show === "badge";
const ifClaudeShowsItsBadge = {
  skip: !claudeShowsItsBadge && "Claude shows its upstream logo (woowtech/vendor-marks.mjs)",
};

// The only shipped files that may draw with SVG path data, each with its reason. The vendor icon
// files are checked on their own against vendor-marks.mjs.
const ALLOWED_DRAWINGS = {
  "packages/app/src/components/icons/vendor-badge.ts": "the badge's own letters",
  "packages/app/src/components/icons/github-icon.tsx":
    "git forge mark, kept by the owner, in pure black or white (section 24)",
  "packages/app/src/components/icons/gitea-icon.tsx": "git forge mark, kept by the owner",
  "packages/app/src/components/icons/forgejo-icon.tsx": "git forge mark, kept by the owner",
  "packages/app/src/components/icons/codeberg-icon.tsx":
    "git forge mark, kept by the owner, in pure black or white (section 24)",
  "packages/app/src/components/icons/paseo-logo.tsx": "the WOOW logo, our own mark",
  "packages/app/src/components/icons/manual-status-icon.tsx": "a plain gear for pipeline status",
  "packages/app/src/components/sidebar/workspace-meta-row/check-indicator.tsx":
    "check and cross marks",
  "packages/app/src/components/material-file-icons.ts":
    "file-type icons the owner kept, each on the notices page or generic (section 24)",
  "packages/app/src/components/markdown/fence/mermaid/runtime/html.gen.ts":
    "the generated Mermaid runtime's diagram shapes",
  "packages/app/src/terminal/native-renderer/terminal-custom-glyph.ts": "terminal box glyphs",
  "packages/app/src/terminal/webview/terminal-emulator-webview-html.ts": "the terminal bundle",
};

// The bitmap images of woowtech smart's own that ship (woowtech/tools/generate-icons.mjs).
const OUR_IMAGES = new Set([
  "packages/app/assets/images/android-icon-foreground.png",
  "packages/app/assets/images/favicon-dark-attention.png",
  "packages/app/assets/images/favicon-dark-running.png",
  "packages/app/assets/images/favicon-dark.png",
  "packages/app/assets/images/favicon-light-attention.png",
  "packages/app/assets/images/favicon-light-running.png",
  "packages/app/assets/images/favicon-light.png",
  "packages/app/assets/images/favicon.png",
  "packages/app/assets/images/icon.png",
  "packages/app/assets/images/notification-icon.png",
  "packages/app/assets/images/splash-icon.png",
  "packages/app/public/apple-touch-icon.png",
  "packages/app/public/pwa-icon-192.png",
  "packages/app/public/pwa-icon-512.png",
  "packages/desktop/assets/128x128.png",
  "packages/desktop/assets/128x128@2x.png",
  "packages/desktop/assets/32x32.png",
  "packages/desktop/assets/64x64.png",
  "packages/desktop/assets/icon-dev.png",
  "packages/desktop/assets/icon.icns",
  "packages/desktop/assets/icon.ico",
  "packages/desktop/assets/icon.png",
]);

// Editor logos upstream keeps in the app package. Nothing in the app requires them (upstream's
// website imports finder.png), so they are not bundled.
const UNREFERENCED_IMAGES_DIR = "packages/app/assets/images/editor-apps/";

// The only places that render an SVG document, each with what it renders. A new one can put a
// host's or a vendor's SVG on screen, so it needs a decision first.
const SVG_RENDER_SITES = {
  "packages/app/src/components/provider-icons.ts": "provider icons; a host's SVG as a badge",
  "packages/app/src/components/provider-catalog-list.tsx": "the ACP catalog's icons",
  "packages/app/src/components/material-file-icon.tsx": "file-type icons",
  "packages/app/src/components/project-icon-image.tsx": "the user's own project icon",
  "packages/app/src/desktop/components/pair-device-section.tsx": "the pairing QR code",
};

// A string or attribute that starts SVG path data: a moveto with two numbers, then a command.
const PATH_DATA = /["'`]\s*[Mm]\s*-?\d*\.?\d+(?:[\s,]+|(?=[-.]))-?\d*\.?\d+\s*[A-Za-z]/;
const SVG_RENDERER =
  /\b(?:SvgXml|SvgCss|SvgUri|SvgCssUri|SvgFromXml|SvgFromUri|SvgWithCss|SvgIcon)\b/;
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;

const squeeze = (text) => text.replace(/[\s,]+/g, "");

function* shippedFiles(fileTypes = SHIPPED_FILES) {
  for (const dir of SHIPPED_DIRS) {
    yield* shippedSourceFiles(path.join(repoRoot, dir), fileTypes);
  }
}

const relative = (file) => path.relative(repoRoot, file);
const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");
const isVendorFile = (file) =>
  marks.some(([, mark]) => mark.files.includes(file)) ||
  VENDOR_SVG_DIRS.some((dir) => file.startsWith(`${dir}/`));

function logosIn(logoPaths) {
  const found = [];
  for (const file of shippedFiles()) {
    const text = squeeze(readFileSync(file, "utf8"));
    for (const [copy, pathData] of logoPaths) {
      if (text.includes(squeeze(pathData))) found.push(`${relative(file)}: ${copy}`);
    }
  }
  return found;
}

test("nothing that ships draws Anthropic's Claude logo", ifClaudeShowsItsBadge, () => {
  const claudeLogo = VENDOR_MARKS.claude.logoPaths.map((pathData) => ["Claude", pathData]);
  assert.equal(
    claudeLogo.length,
    2,
    "the Claude logo's path data is missing from vendor-marks.mjs",
  );
  assert.deepEqual(
    logosIn(claudeLogo),
    [],
    "Draw Claude with the text badge in vendor-badge.ts instead.",
  );
});

test("nothing that ships draws the logo of another vendor that shows its badge", () => {
  const logos = showingBadge
    .filter(([vendor]) => vendor !== "claude")
    .flatMap(([vendor, mark]) => mark.logoPaths.map((pathData) => [vendor, pathData]));
  assert.deepEqual(
    logosIn(logos),
    [],
    "Draw the vendor with its text badge (woowtech/vendor-marks.mjs) instead.",
  );
});

test(
  "Claude icon files draw only in the caller's color, never Anthropic's orange",
  ifClaudeShowsItsBadge,
  () => {
    // The badge takes the color the caller passes (the theme's foreground), so a Claude icon
    // file has no color of its own: no hex, rgb() or hsl() value such as Claude's #D97757.
    const iconFiles = [...shippedFiles()].filter(
      (file) =>
        /claude|anthropic/i.test(path.basename(file)) &&
        /[/\\](?:icons|assets|public)[/\\]/.test(relative(file)),
    );
    assert.ok(iconFiles.length >= 4, `the Claude icon files were not found: ${iconFiles}`);
    const colored = iconFiles.filter((file) => COLOR.test(readFileSync(file, "utf8")));
    assert.deepEqual(colored.map(relative), []);
  },
);

test("every Claude icon the app renders is the text badge", ifClaudeShowsItsBadge, () => {
  const badge = "packages/app/src/components/icons/claude-badge.ts";
  const { CLAUDE_BADGE_SVG } = requireSource(badge);
  const { vendorBadgeSvg } = requireSource("packages/app/src/components/icons/vendor-badge.ts");
  const { ACP_PROVIDER_ICON_SVGS } = requireSource(ACP_ICONS_FILE);

  assert.match(CLAUDE_BADGE_SVG, /<rect [^>]*rx="\d/, `${badge} has lost its rounded square`);
  assert.equal(CLAUDE_BADGE_SVG, vendorBadgeSvg("claude"));
  assert.deepEqual(
    {
      "packages/app/assets/icons/claude.svg": read("packages/app/assets/icons/claude.svg"),
      "packages/app/src/assets/acp-provider-icons/claude-acp.svg": read(
        "packages/app/src/assets/acp-provider-icons/claude-acp.svg",
      ),
      'ACP_PROVIDER_ICON_SVGS["claude-acp"]': ACP_PROVIDER_ICON_SVGS["claude-acp"],
    },
    {
      "packages/app/assets/icons/claude.svg": CLAUDE_BADGE_SVG,
      "packages/app/src/assets/acp-provider-icons/claude-acp.svg": CLAUDE_BADGE_SVG,
      'ACP_PROVIDER_ICON_SVGS["claude-acp"]': CLAUDE_BADGE_SVG,
    },
  );
});

test("every vendor icon file is as woowtech/vendor-marks.mjs says", () => {
  // A vendor that shows its badge: the badge in its icon component, SVGs and ACP entries, and no
  // desktop logo. A vendor that shows its upstream logo: its files as upstream ships them.
  const { vendorBadgeSvg } = requireSource("packages/app/src/components/icons/vendor-badge.ts");
  const { ACP_PROVIDER_ICON_SVGS } = requireSource(ACP_ICONS_FILE);
  const differing = Object.entries(expectedVendorFiles())
    .filter(([file, content]) => {
      const absolute = path.join(repoRoot, file);
      if (content === null) return existsSync(absolute);
      return (
        !existsSync(absolute) || Buffer.compare(readFileSync(absolute), Buffer.from(content)) !== 0
      );
    })
    .map(([file]) => file);
  if (read(ACP_ICONS_FILE) !== expectedAcpIconsSource()) differing.push(ACP_ICONS_FILE);
  assert.deepEqual(differing, [], "Run node woowtech/tools/write-vendor-badges.mjs.");

  const badgeIcons = showingBadge.flatMap(([, mark]) => mark.acpIcons);
  const notBadges = badgeIcons.filter((id) => ACP_PROVIDER_ICON_SVGS[id] !== vendorBadgeSvg(id));
  assert.deepEqual(notBadges, []);
});

test("every vendor icon upstream ships is in woowtech/vendor-marks.mjs, once", () => {
  const listed = marks.flatMap(([, mark]) => mark.files);
  const shipped = [
    ...VENDOR_SVG_DIRS.flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir)).map((name) => `${dir}/${name}`),
    ),
    ...(existsSync(path.join(repoRoot, EDITOR_LOGO_DIR))
      ? readdirSync(path.join(repoRoot, EDITOR_LOGO_DIR)).map(
          (name) => `${EDITOR_LOGO_DIR}/${name}`,
        )
      : []),
  ];
  assert.deepEqual(
    shipped.filter((file) => !listed.includes(file)),
    [],
    "Add the vendor to woowtech/vendor-marks.mjs.",
  );
  assert.deepEqual(
    listed.filter((file, index) => listed.indexOf(file) !== index),
    [],
    "A file belongs to two vendors.",
  );

  const { ACP_PROVIDER_ICON_SVGS } = requireSource(ACP_ICONS_FILE);
  const icons = new Set(marks.flatMap(([, mark]) => mark.acpIcons));
  assert.deepEqual(
    Object.keys(ACP_PROVIDER_ICON_SVGS).filter((id) => !icons.has(id)),
    [],
    "Add the ACP icon to a vendor in woowtech/vendor-marks.mjs.",
  );
  assert.deepEqual(
    marks
      .filter(([, mark]) => !["badge", "upstream"].includes(mark.show))
      .map(([vendor]) => vendor),
    [],
    'Each vendor shows "badge" or "upstream".',
  );
});

test("vendor badge files draw only in the caller's color", () => {
  const acpAllBadges = showingUpstream.every(([, mark]) => mark.acpIcons.length === 0);
  const badgeFiles = [
    "packages/app/src/components/icons/vendor-badge.ts",
    "packages/app/src/components/icons/vendor-badge-icon.tsx",
    ...(acpAllBadges ? [ACP_ICONS_FILE] : []),
    ...showingBadge.flatMap(([, mark]) => mark.files).filter((file) => !file.endsWith(".png")),
  ];
  assert.deepEqual(
    badgeFiles.filter((file) => COLOR.test(read(file))),
    [],
  );
});

test("only the allowlisted files draw with SVG path data", () => {
  const acpDraws = showingUpstream.some(([, mark]) => mark.acpIcons.length > 0);
  const allowed = new Set([
    ...Object.keys(ALLOWED_DRAWINGS),
    ...upstreamFiles,
    ...(acpDraws ? [ACP_ICONS_FILE] : []),
  ]);
  const drawing = [...shippedFiles()]
    .map(relative)
    .filter((file) => !isVendorFile(file) || upstreamFiles.includes(file))
    .filter((file) => PATH_DATA.test(read(file)));
  assert.deepEqual(
    drawing.filter((file) => !allowed.has(file)),
    [],
    "A new drawing ships. If it is a vendor's logo, give the vendor its text badge in " +
      "woowtech/vendor-marks.mjs; if it is not, add it to ALLOWED_DRAWINGS with the reason.",
  );
  const stale = Object.keys(ALLOWED_DRAWINGS).filter((file) => !drawing.includes(file));
  assert.deepEqual(stale, [], "Remove allowlisted files that no longer draw.");
});

test("only woowtech smart's own images ship, and the vendor logos cleared for use", () => {
  const images = [...shippedFiles(IMAGE_FILES)].map(relative).filter((file) => !isVendorFile(file));
  const unexpected = images.filter(
    (file) => !OUR_IMAGES.has(file) && !file.startsWith(UNREFERENCED_IMAGES_DIR),
  );
  assert.deepEqual(
    unexpected,
    [],
    "A new image ships. If it is a vendor's logo, list it in woowtech/vendor-marks.mjs.",
  );

  const references = [
    ...shippedFiles(/\.(?:[cm]?[jt]sx?|json|html|css)$/),
    path.join(repoRoot, "packages/app/app.config.js"),
  ]
    .map((file) => [relative(file), readFileSync(file, "utf8")])
    .filter(([, text]) => text.includes("editor-apps"))
    .map(([file]) => file);
  assert.deepEqual(references, [], "The unreferenced editor logos are now used; badge them.");
});

test("only the allowlisted places render an SVG document", () => {
  const sites = [...shippedFiles(/\.[cm]?[jt]sx?$/)]
    .map(relative)
    .filter((file) => file.startsWith("packages/app/") && SVG_RENDERER.test(read(file)));
  assert.deepEqual(
    sites.filter((file) => !(file in SVG_RENDER_SITES)),
    [],
    "A new place renders SVG documents. A host's or vendor's SVG must show as a text badge.",
  );
  for (const file of Object.keys(SVG_RENDER_SITES)) {
    assert.ok(existsSync(path.join(repoRoot, file)), `${file} is gone; update SVG_RENDER_SITES`);
  }
});

test("no provider shows the SVG a host sends for it", async () => {
  // A known provider resolves to its own icon before any host SVG; for any other provider the
  // app draws the badge in place of the host's SVG.
  const { replaceProviderSnapshotIcons, resolveProviderIconName } = requireSource(
    "packages/app/src/components/provider-icon-name.ts",
  );
  const { KNOWN_PROVIDER_ICON_NAMES } = await importSource(
    "packages/protocol/src/provider-icon-names.ts",
  );
  const hostSvg = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>';
  replaceProviderSnapshotIcons(
    "guard-host",
    [...KNOWN_PROVIDER_ICON_NAMES, "claude-acp"].map((provider) => ({
      provider,
      iconSvg: hostSvg,
    })),
  );
  const showingHostSvg = [...KNOWN_PROVIDER_ICON_NAMES, "claude-acp"].filter(
    (provider) => resolveProviderIconName(provider, "guard-host").kind === "svg",
  );
  assert.deepEqual(showingHostSvg, []);

  const providerIcons = read("packages/app/src/components/provider-icons.ts");
  assert.ok(
    providerIcons.includes(
      "return getSnapshotProviderIcon(`${serverId}:${provider}`, vendorBadgeSvg(provider));",
    ),
    "provider-icons.ts must draw the badge in place of a host's SVG.",
  );
  assert.doesNotMatch(providerIcons, /getSnapshotProviderIcon\([^)]*name\.svg\)/);
});

test("no theme is named after Claude, and the Claude theme keeps its id", async () => {
  const { i18n } = requireSource("packages/app/src/i18n/i18next.ts");
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  // Claude in the scripts upstream's translations use, including es's "claudio".
  const namesClaude = /claud|クロード|클로드|克劳德|克勞德|كلود|клод/i;
  const naming = Object.keys(i18n.store.data).flatMap((language) =>
    Object.entries(i18n.getResource(language, "translation", "settings.appearance.theme.options"))
      .filter(([, label]) => namesClaude.test(label))
      .map(([theme, label]) => `${language} ${theme}: ${label}`),
  );
  assert.deepEqual(naming, []);
  assert.equal(i18n.t("settings.appearance.theme.options.claude", { lng: "zh-TW" }), "陶土");
  assert.equal(i18n.t("settings.appearance.theme.options.claude", { lng: "en" }), "Terracotta");

  // The saved preference is the id and unistyles name, so both stay.
  assert.match(
    read("packages/app/src/styles/theme.ts"),
    /name: "claude",\s*group: "variant",\s*unistylesName: "darkClaude",/,
  );
});
