// woowtech smart's icons: the blue WOOW symbol on white (the brand choice), in the
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

function repoPath(relative) {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

const images = "packages/app/assets/images";
const desktop = "packages/desktop/assets";
const favicons = ["", "-light", "-dark", "-light-running", "-light-attention", "-dark-running", "-dark-attention"];

// Icons that show the blue symbol, with their required pixel size.
const SYMBOL_ICONS = [
  { path: `${images}/icon.png`, size: 1024, opaque: true },
  { path: `${images}/android-icon-foreground.png`, size: 1024 },
  { path: `${images}/splash-icon.png`, size: 200 },
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
  assert.ok(shareOfPixels(image, nearlyBlack) < 0.02, `${label} looks like upstream Paseo's black tile`);
}

/** The largest PNG image stored in an .icns or .ico file. */
function largestEmbeddedPng(file) {
  const data = readFileSync(repoPath(file));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const pngs = [];
  for (let offset = data.indexOf(signature); offset !== -1; offset = data.indexOf(signature, offset + 8)) {
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

test("Android's adaptive icon sits on white", () => {
  const { adaptiveIcon } = expoPrebuildConfig("production").android;
  assert.equal(adaptiveIcon.backgroundColor.toLowerCase(), "#ffffff");
});

test("the app's logo component draws the WOOW symbol from woowtech/brand", () => {
  const brand = readFileSync(repoPath("woowtech/brand/woowtech-symbol-path.svg"), "utf8");
  const component = readFileSync(repoPath("packages/app/src/components/icons/paseo-logo.tsx"), "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(brand)?.[1];
  const strokes = [...brand.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

  assert.ok(strokes.length > 0, "the brand symbol has no strokes");
  assert.ok(component.includes(`viewBox="${viewBox}"`), "the logo is not drawn on the symbol's viewBox");
  for (const stroke of strokes) {
    assert.ok(component.includes(stroke), "the logo is missing a stroke of the symbol");
  }
});
