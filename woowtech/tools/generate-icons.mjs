// Generates a brand's app, web and desktop icons from its logo (woowtech/brands): the logo
// in its tile color on white tiles for app icons (woowtech smart: the blue WOOW symbol,
// distinct from WOOW Home's blue tiles; Apporo smart: the grey mark, as Apporo's other apps),
// the bare logo on a transparent background wherever it sits on the app's own background
// (splash screens, favicons, the iOS dark icon, Android's themed icon) in its logo color, or its
// color for dark backgrounds where the background is dark (Apporo smart: dark grey and white;
// woowtech smart: its blue on both), a white logo for Android notifications, and a tile in the
// brand color for development desktop builds.
//
//   node woowtech/tools/generate-icons.mjs                    # the applied brand, into the packages
//   node woowtech/tools/generate-icons.mjs --out DIR          # write a preview set to DIR
//   node woowtech/tools/generate-icons.mjs --brand apporo --out woowtech/brands/apporo/assets
//
// Another brand's icons live under woowtech/brands/<id>/assets, laid out like the repository;
// woowtech/tools/apply-brand.mjs copies them into place.
//
// Needs Google Chrome (headless rendering), sips and iconutil (macOS).
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeOpaquePng, readPng } from "../png.mjs";

const require = createRequire(import.meta.url);
const { appliedBrandId, loadBrand } = require("../brands/index.cjs");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const brandIndex = process.argv.indexOf("--brand");
const brand = loadBrand(brandIndex === -1 ? appliedBrandId() : process.argv[brandIndex + 1]);

const TILE_BORDER = "#e3e6ee";
const RUNNING_DOT = "#3b82f6";
const ATTENTION_DOT = "#22c55e";
const MASTER = 1024;

const outIndex = process.argv.indexOf("--out");
const outRoot = outIndex === -1 ? repoRoot : path.resolve(process.argv[outIndex + 1]);
const work = mkdtempSync(path.join(tmpdir(), "woowtech-icons-"));

/** The brand's logo in one color, as an SVG file to draw with. */
function logoFile(name, fill) {
  const file = path.join(work, `${name}.svg`);
  const paths = brand.logo.paths.map((d) => `<path fill="${fill}" d="${d}"/>`).join("");
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brand.logo.viewBox}">${paths}</svg>`,
  );
  return file;
}

const TILE_SYMBOL = logoFile("logo-tile", brand.logo.tileColor);
const CLEAR_SYMBOL = logoFile("logo-clear", brand.logo.color);
const CLEAR_SYMBOL_ON_DARK = logoFile("logo-clear-dark", brand.logo.colorOnDark);
const WHITE_SYMBOL = logoFile("logo-white", "#ffffff");
// How wide the mark is in each kind of icon, in percent of the canvas.
const WIDTH = brand.logo.markWidths;
// A "badge" brand draws its logo on the app's own background as its mark inside a white disc with
// a light ring (Apporo smart until 2026-10-30). Both brands draw the bare mark there now.
const BADGE = brand.logo.style === "badge";

// --- compositions (CSS on a MASTER-sized transparent canvas) -----------------

function symbol(src, widthPercent) {
  return `<img src="file://${src}" style="position:absolute;left:50%;top:50%;width:${widthPercent}%;transform:translate(-50%,-50%)">`;
}

function page(body) {
  return `<html><head><style>html,body{margin:0;background:transparent}</style></head><body><div style="position:relative;width:${MASTER}px;height:${MASTER}px">${body}</div></body></html>`;
}

/** A status dot in the bottom-right corner (favicons). */
function statusDot(color) {
  return color
    ? `<div style="position:absolute;right:0;bottom:0;width:${MASTER * 0.36}px;height:${MASTER * 0.36}px;border-radius:50%;background:${color}"></div>`
    : "";
}

/**
 * The bare symbol on a transparent canvas. A white tile would show as a white box on
 * a dark background: Android's dark splash screen did (2026-10-07).
 */
function clear({ glyph, glyphWidth, dot }) {
  return page(`${symbol(glyph, glyphWidth)}${statusDot(dot)}`);
}

/** The brand's badge: a white disc `diameter` percent of the canvas wide, the mark inside it. */
function badge({ diameter, dot }) {
  const size = (MASTER * diameter) / 100;
  const ring = Math.round(size * 0.03);
  return page(
    `<div style="position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;transform:translate(-50%,-50%);border-radius:50%;background:#ffffff;box-shadow:inset 0 0 0 ${ring}px ${brand.logo.badgeRing}">${symbol(TILE_SYMBOL, WIDTH.badge)}</div>${statusDot(dot)}`,
  );
}

/**
 * The logo on a transparent canvas: the brand's badge, or its bare symbol in the logo color for
 * a light background or, with `onDark`, for a dark one.
 */
function onOwnBackground({ glyphWidth, badgeDiameter, dot, onDark = false }) {
  return BADGE
    ? badge({ diameter: badgeDiameter, dot })
    : clear({ glyph: onDark ? CLEAR_SYMBOL_ON_DARK : CLEAR_SYMBOL, glyphWidth, dot });
}

/** A square tile, inset from the canvas edge, holding a centered symbol. */
function tile({ inset, radius, fill, border, shadow = "none", glyph, glyphWidth, dot }) {
  const size = MASTER - inset * 2;
  const borderCss = border
    ? `box-shadow:inset 0 0 0 ${Math.round(MASTER * 0.012)}px ${border}${shadow === "none" ? "" : `,${shadow}`};`
    : `box-shadow:${shadow};`;
  const dotHtml = statusDot(dot);
  return page(
    `<div style="position:absolute;left:${inset}px;top:${inset}px;width:${size}px;height:${size}px;border-radius:${radius}px;background:${fill};${borderCss}">${symbol(glyph, glyphWidth)}</div>${dotHtml}`,
  );
}

const compositions = {
  // Full-bleed square: the launcher (iOS, Android legacy) applies its own mask.
  fullBleed: page(
    `<div style="position:absolute;inset:0;background:#ffffff">${symbol(TILE_SYMBOL, WIDTH.appIcon)}</div>`,
  ),
  // Android adaptive icon foreground: the symbol inside the 66% safe zone.
  androidForeground: page(symbol(TILE_SYMBOL, WIDTH.androidForeground)),
  // Android notification icons are drawn as a white silhouette.
  notification: page(symbol(WHITE_SYMBOL, 84)),
  tile: tile({
    inset: 20,
    radius: 230,
    fill: "#ffffff",
    border: TILE_BORDER,
    glyph: TILE_SYMBOL,
    glyphWidth: WIDTH.pwaTile,
  }),
  // Android 12+ draws the splash icon inside a circle two thirds of the canvas wide, so the
  // WOOW symbol (105.2 x 83.4) is 50% wide: its diagonal, 64%, stays inside the circle. A badge
  // is 64% wide, inside the same circle.
  splash: onOwnBackground({ glyphWidth: 50, badgeDiameter: 64 }),
  // The dark splash screen (black, app.config.js) gets the logo in its color for dark backgrounds.
  splashDark: onOwnBackground({ glyphWidth: 50, badgeDiameter: 64, onDark: true }),
  // Favicons show at 16-32px, so the logo fills almost the whole canvas. A badge is 70% wide, so
  // its disc and the status dot together cover less than half of it. The -dark favicons are the
  // ones a browser in dark mode shows (hooks/use-favicon-status.ts).
  favicon: onOwnBackground({ glyphWidth: 92, badgeDiameter: 70 }),
  faviconRunning: onOwnBackground({ glyphWidth: 92, badgeDiameter: 70, dot: RUNNING_DOT }),
  faviconAttention: onOwnBackground({ glyphWidth: 92, badgeDiameter: 70, dot: ATTENTION_DOT }),
  faviconDark: onOwnBackground({ glyphWidth: 92, badgeDiameter: 70, onDark: true }),
  faviconDarkRunning: onOwnBackground({
    glyphWidth: 92,
    badgeDiameter: 70,
    dot: RUNNING_DOT,
    onDark: true,
  }),
  faviconDarkAttention: onOwnBackground({
    glyphWidth: 92,
    badgeDiameter: 70,
    dot: ATTENTION_DOT,
    onDark: true,
  }),
  // iOS 18 dark app icon: the system draws the (dark) background, the icon gives the symbol at
  // the size of the light icon's. No tinted icon: prebuild flattens it onto white (withIosIcons).
  iosDark: clear({ glyph: CLEAR_SYMBOL_ON_DARK, glyphWidth: WIDTH.appIcon }),
  // Android 13+ themed icon: a silhouette with the adaptive foreground's geometry.
  androidMonochrome: clear({ glyph: WHITE_SYMBOL, glyphWidth: WIDTH.androidForeground }),
  // macOS icon grid: an 824px tile inside the 1024px canvas, with a soft shadow.
  desktop: tile({
    inset: 100,
    radius: 185,
    fill: "#ffffff",
    border: TILE_BORDER,
    shadow: "0 10px 22px rgba(26,29,41,0.18)",
    glyph: TILE_SYMBOL,
    glyphWidth: WIDTH.desktopTile,
  }),
  desktopDev: tile({
    inset: 100,
    radius: 185,
    fill: brand.colors.primary,
    shadow: "0 10px 22px rgba(26,29,41,0.18)",
    glyph: WHITE_SYMBOL,
    glyphWidth: WIDTH.desktopTile,
  }),
};

function renderMaster(name) {
  const html = path.join(work, `${name}.html`);
  const png = path.join(work, `${name}.png`);
  writeFileSync(html, compositions[name]);
  const args = [
    "--headless=new",
    // A profile of its own, so a Chrome the person has open is never involved.
    `--user-data-dir=${path.join(work, "chrome-profile")}`,
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--default-background-color=00000000",
    `--window-size=${MASTER},${MASTER}`,
    `--screenshot=${png}`,
    `file://${html}`,
  ];
  // Headless Chrome sometimes crashes while shutting down (exit code 2, "Teardown watchdog
  // expired") after it wrote the screenshot, so the file decides, with up to three tries.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    rmSync(png, { force: true });
    try {
      execFileSync(CHROME, args, { stdio: "ignore" });
    } catch (error) {
      if (!existsSync(png) || statSync(png).size === 0) {
        if (attempt === 3) throw error;
        continue;
      }
    }
    if (existsSync(png) && statSync(png).size > 0) return png;
  }
  throw new Error(`Chrome wrote no screenshot for ${name}`);
}

// --- PNG helpers ---------------------------------------------------------------

function resized(master, size) {
  const out = path.join(work, `${path.basename(master, ".png")}-${size}.png`);
  execFileSync("sips", ["-z", String(size), String(size), master, "--out", out], {
    stdio: "ignore",
  });
  return out;
}

/** The icon without an alpha channel (App Store icons must not have one). */
function withoutAlpha(file) {
  return encodeOpaquePng(readPng(file));
}

/** A Windows .ico holding PNG images at the given sizes. */
function ico(master, sizes) {
  const images = sizes.map((size) => readFileSync(resized(master, size)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  return Buffer.concat([header, ...images]);
}

function icns(master) {
  const iconset = path.join(work, "icon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(
      path.join(iconset, `icon_${size}x${size}.png`),
      readFileSync(resized(master, size)),
    );
    writeFileSync(
      path.join(iconset, `icon_${size}x${size}@2x.png`),
      readFileSync(resized(master, size * 2)),
    );
  }
  const out = path.join(work, "icon.icns");
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", out], { stdio: "ignore" });
  return readFileSync(out);
}

// --- outputs --------------------------------------------------------------------

function write(relative, contents) {
  const target = path.join(outRoot, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  console.log(`  ${relative}`);
}

try {
  const masters = Object.fromEntries(
    Object.keys(compositions).map((name) => [name, renderMaster(name)]),
  );
  const png = (master, size) =>
    readFileSync(size === MASTER ? masters[master] : resized(masters[master], size));

  write("packages/app/assets/images/icon.png", withoutAlpha(masters.fullBleed));
  write("packages/app/assets/images/android-icon-foreground.png", png("androidForeground", MASTER));
  write("packages/app/assets/images/notification-icon.png", png("notification", 96));
  write("packages/app/assets/images/splash-icon.png", png("splash", 800));
  write("packages/app/assets/images/splash-icon-dark.png", png("splashDark", 800));
  write("packages/app/assets/images/ios-icon-dark.png", png("iosDark", MASTER));
  write("packages/app/assets/images/android-icon-monochrome.png", png("androidMonochrome", MASTER));
  for (const name of ["favicon", "favicon-light"]) {
    write(`packages/app/assets/images/${name}.png`, png("favicon", 48));
  }
  write("packages/app/assets/images/favicon-light-running.png", png("faviconRunning", 48));
  write("packages/app/assets/images/favicon-light-attention.png", png("faviconAttention", 48));
  write("packages/app/assets/images/favicon-dark.png", png("faviconDark", 48));
  write("packages/app/assets/images/favicon-dark-running.png", png("faviconDarkRunning", 48));
  write("packages/app/assets/images/favicon-dark-attention.png", png("faviconDarkAttention", 48));
  write("packages/app/public/apple-touch-icon.png", withoutAlpha(resized(masters.fullBleed, 180)));
  write("packages/app/public/pwa-icon-192.png", png("tile", 192));
  write("packages/app/public/pwa-icon-512.png", png("tile", 512));
  write("packages/desktop/assets/icon.png", png("desktop", 512));
  write("packages/desktop/assets/32x32.png", png("desktop", 32));
  write("packages/desktop/assets/64x64.png", png("desktop", 64));
  write("packages/desktop/assets/128x128.png", png("desktop", 128));
  write("packages/desktop/assets/128x128@2x.png", png("desktop", 256));
  write("packages/desktop/assets/icon.icns", icns(masters.desktop));
  write("packages/desktop/assets/icon.ico", ico(masters.desktop, [16, 24, 32, 48, 64, 128, 256]));
  write("packages/desktop/assets/icon-dev.png", png("desktopDev", MASTER));
} finally {
  rmSync(work, { recursive: true, force: true });
}
