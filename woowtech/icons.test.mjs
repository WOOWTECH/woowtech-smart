// woowtech smart's icons: the blue WOOW symbol on white app-icon tiles (the brand choice) and
// on a transparent background wherever it sits on the app's own background, in the
// sizes and formats each platform requires. The checks look at what the pictures
// contain, so an upstream merge that brings Paseo's icons back fails here.
//
//   node --test woowtech/icons.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { expoPrebuildConfig } from "./expo-config.mjs";
import { readPng } from "./png.mjs";
import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";

function repoPath(relative) {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

const images = "packages/app/assets/images";
const desktop = "packages/desktop/assets";
const favicons = [
  "",
  "-light",
  "-dark",
  "-light-running",
  "-light-attention",
  "-dark-running",
  "-dark-attention",
];

// Icons that show the blue symbol, with their required pixel size.
const SYMBOL_ICONS = [
  { path: `${images}/icon.png`, size: 1024, opaque: true },
  { path: `${images}/android-icon-foreground.png`, size: 1024 },
  { path: `${images}/splash-icon.png`, size: 800 },
  { path: `${images}/ios-icon-dark.png`, size: 1024 },
  ...favicons.map((suffix) => ({ path: `${images}/favicon${suffix}.png`, size: 48 })),
  { path: "packages/app/public/apple-touch-icon.png", size: 180, opaque: true },
  { path: "packages/app/public/pwa-icon-192.png", size: 192 },
  { path: "packages/app/public/pwa-icon-512.png", size: 512 },
  { path: `${desktop}/icon.png`, size: 512 },
  { path: `${desktop}/32x32.png`, size: 32 },
  { path: `${desktop}/64x64.png`, size: 64 },
  { path: `${desktop}/128x128.png`, size: 128 },
  { path: `${desktop}/128x128@2x.png`, size: 256 },
  { path: `${desktop}/icon-dev.png`, size: 1024 },
];

function shareOfPixels(image, matches) {
  let count = 0;
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    const [red, green, blue, alpha] = image.rgba.subarray(offset, offset + 4);
    if (alpha > 128 && matches(red, green, blue)) count += 1;
  }
  return count / (image.width * image.height);
}

const clearlyBlue = (red, green, blue) => blue - red > 60 && blue - green > 40;
const nearlyBlack = (red, green, blue) => red + green + blue < 90;

function assertShowsTheBlueSymbol(image, label) {
  assert.ok(shareOfPixels(image, clearlyBlue) > 0.01, `${label} shows no brand-blue symbol`);
  assert.ok(
    shareOfPixels(image, nearlyBlack) < 0.02,
    `${label} looks like upstream Paseo's black tile`,
  );
}

/** The largest PNG image stored in an .icns or .ico file. */
function largestEmbeddedPng(file) {
  const data = readFileSync(repoPath(file));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const pngs = [];
  for (
    let offset = data.indexOf(signature);
    offset !== -1;
    offset = data.indexOf(signature, offset + 8)
  ) {
    const end = data.indexOf("IEND", offset);
    if (end !== -1) pngs.push(data.subarray(offset, end + 8));
  }
  assert.ok(pngs.length > 0, `${file} holds no PNG images`);
  return pngs.map((png) => readPng(Buffer.from(png))).sort((a, b) => b.width - a.width)[0];
}

test("app, web and desktop icons show the blue WOOW symbol, not Paseo's black tile", () => {
  for (const icon of SYMBOL_ICONS) {
    assertShowsTheBlueSymbol(readPng(repoPath(icon.path)), icon.path);
  }
  for (const file of [`${desktop}/icon.icns`, `${desktop}/icon.ico`]) {
    assertShowsTheBlueSymbol(largestEmbeddedPng(file), file);
  }
});

test("icons have the sizes and formats their platforms require", () => {
  for (const icon of SYMBOL_ICONS) {
    const image = readPng(repoPath(icon.path));
    assert.deepEqual([image.width, image.height], [icon.size, icon.size], icon.path);
    if (icon.opaque) {
      assert.equal(image.colorType, 2, `${icon.path} must not have an alpha channel`);
    }
  }

  // Android draws notification icons from their alpha channel: a white silhouette.
  const notification = readPng(repoPath(`${images}/notification-icon.png`));
  assert.deepEqual([notification.width, notification.height], [96, 96]);
  assert.ok(shareOfPixels(notification, () => true) > 0.05, "the notification icon is empty");
  assert.equal(
    shareOfPixels(notification, (red, green, blue) => Math.min(red, green, blue) < 230),
    0,
    "the notification icon is not a white silhouette",
  );
});

// The logo on the app's own background has no tile: a white tile showed as a white box on
// Android's dark splash screen (2026-10-07). App icons keep theirs (SYMBOL_ICONS, opaque).
const CLEAR_LOGOS = [
  `${images}/splash-icon.png`,
  ...favicons.map((suffix) => `${images}/favicon${suffix}.png`),
  `${images}/ios-icon-dark.png`,
  `${images}/ios-icon-tinted.png`,
  `${images}/android-icon-monochrome.png`,
];

/** The share of the outermost pixel ring that is transparent, and that is opaque white. */
function border(image) {
  const { width, height, rgba } = image;
  let clear = 0;
  let white = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = rgba.subarray(offset, offset + 4);
      total += 1;
      if (alpha < 16) clear += 1;
      if (alpha > 200 && Math.min(red, green, blue) > 235) white += 1;
    }
  }
  return { clear: clear / total, white: white / total };
}

test("the logo has a transparent background wherever it sits on the app's own background", () => {
  for (const file of CLEAR_LOGOS) {
    const image = readPng(repoPath(file));
    const edge = border(image);
    // Favicons' status dot touches the corner.
    assert.ok(
      edge.clear > 0.9,
      `${file} has a background: ${Math.round(edge.clear * 100)}% of its edge is clear`,
    );
    assert.equal(edge.white, 0, `${file} sits on a white tile`);
    assert.ok(shareOfPixels(image, () => true) < 0.5, `${file} covers most of its canvas`);
  }
  // Tinted and themed icons are silhouettes: the system colors them.
  for (const file of [`${images}/ios-icon-tinted.png`, `${images}/android-icon-monochrome.png`]) {
    const image = readPng(repoPath(file));
    assert.deepEqual([image.width, image.height], [1024, 1024], file);
    assert.ok(shareOfPixels(image, () => true) > 0.03, `${file} is empty`);
    assert.equal(
      shareOfPixels(image, (red, green, blue) => Math.min(red, green, blue) < 230),
      0,
      `${file} is not a white silhouette`,
    );
  }
});

test("iOS has dark and tinted icons, and Android a themed one", () => {
  const config = expoPrebuildConfig("production");
  assert.deepEqual(config.ios.icon, {
    light: "./assets/images/icon.png",
    dark: "./assets/images/ios-icon-dark.png",
    tinted: "./assets/images/ios-icon-tinted.png",
  });
  assert.equal(
    config.android.adaptiveIcon.monochromeImage,
    "./assets/images/android-icon-monochrome.png",
  );
});

test("the dark splash screen gets its own logo drawables on Android", () => {
  // Android composites the splash logo onto a square of the splash background color, and makes
  // the night drawables only when dark names an image: without one, the white square of the light
  // splash showed on the black dark splash (2026-10-07).
  const splash = expoPrebuildConfig("production").plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  );
  assert.ok(splash, "the expo-splash-screen plugin is not configured");
  assert.equal(splash[1].image, "./assets/images/splash-icon.png");
  assert.equal(splash[1].dark?.image, "./assets/images/splash-icon.png");
  assert.equal(splash[1].dark?.backgroundColor?.toLowerCase(), "#000000");
});

test("Android's adaptive icon sits on white", () => {
  const { adaptiveIcon } = expoPrebuildConfig("production").android;
  assert.equal(adaptiveIcon.backgroundColor.toLowerCase(), "#ffffff");
});

test("Android tints the notification icon brand blue, not Paseo's green", () => {
  const notifications = expoPrebuildConfig("production").plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications",
  );
  assert.ok(notifications, "the expo-notifications plugin is not configured");
  assert.equal(notifications[1]?.color?.toLowerCase(), "#6183fc");
});

test("the app's logo component draws the WOOW symbol from woowtech/brand", () => {
  const brand = readFileSync(repoPath("woowtech/brand/woowtech-symbol-path.svg"), "utf8");
  const component = readFileSync(
    repoPath("packages/app/src/components/icons/paseo-logo.tsx"),
    "utf8",
  );
  const viewBox = /viewBox="([^"]+)"/.exec(brand)?.[1];
  const strokes = [...brand.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

  assert.ok(strokes.length > 0, "the brand symbol has no strokes");
  assert.ok(
    component.includes(`viewBox="${viewBox}"`),
    "the logo is not drawn on the symbol's viewBox",
  );
  for (const stroke of strokes) {
    assert.ok(component.includes(stroke), "the logo is missing a stroke of the symbol");
  }
});

test("the startup splash draws the WOOW symbol in the brand blue", () => {
  // Upstream fills the web and desktop splash mask with the theme's foreground: white or black.
  const splash = readFileSync(
    repoPath("packages/app/src/screens/startup-splash-screen.tsx"),
    "utf8",
  );
  const start = splash.indexOf("function LogoShimmer()");
  const end = splash.indexOf("function WebLogoShimmer(");
  assert.ok(start !== -1 && end > start, "the splash no longer has LogoShimmer");
  const shimmer = splash.slice(start, end);
  assert.match(shimmer, /<WebLogoShimmer color=\{BRAND_BLUE\} \/>/);
  assert.match(shimmer, /<NativeLogoShimmer color=\{BRAND_BLUE\} \/>/);
});

test("nothing that ships draws upstream Paseo's butterfly mark", () => {
  // Upstream's logo component, favicons and web splash mask all drew this path. The web splash
  // kept it after the logo component changed, until the 2026-09-29 fix (README section 8).
  // Compared with whitespace and commas removed, so reformatting a copy does not hide it.
  const squeeze = (text) => text.replace(/[\s,]+/g, "");
  const paseoMark = squeeze("M291.495 91.399C333.897 104.892 379.155 135.075 416.229 173.191");
  const shippedDirs = [
    "packages/app/src",
    "packages/app/assets",
    "packages/app/public",
    "packages/app/plugins",
    "packages/desktop/src",
    "packages/desktop/assets",
    "packages/server/src",
    "packages/cli/src",
  ];
  const drawing = shippedDirs
    .flatMap((dir) =>
      Array.from(shippedSourceFiles(repoPath(dir), /\.(?:[cm]?[jt]sx?|json|svg|html|css|xml)$/)),
    )
    .filter((file) => squeeze(readFileSync(file, "utf8")).includes(paseoMark))
    .map((file) => file.slice(repoRoot.length));
  assert.deepEqual(drawing, [], "Draw the WOOW symbol from paseo-logo.tsx instead.");
});
