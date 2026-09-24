// Generates woowtech smart's app, web and desktop icons from the brand symbol in
// woowtech/brand: the blue symbol on white tiles (the brand choice, distinct from
// WOOW Home's blue tiles), a white symbol for Android notifications, and a blue
// tile for development desktop builds.
//
//   node woowtech/tools/generate-icons.mjs              # write into the packages
//   node woowtech/tools/generate-icons.mjs --out DIR    # write a preview set to DIR
//
// Needs Google Chrome (headless rendering), sips and iconutil (macOS).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeOpaquePng, readPng } from "../png.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
// The symbol flattened to plain paths (woowtech/tools/flatten-symbol.py), in brand blue.
const SYMBOL_SOURCE = path.join(repoRoot, "woowtech/brand/woowtech-symbol-path.svg");

const BRAND_BLUE = "#6183fc";
const TILE_BORDER = "#e3e6ee";
const RUNNING_DOT = "#3b82f6";
const ATTENTION_DOT = "#22c55e";
const MASTER = 1024;

const outIndex = process.argv.indexOf("--out");
const outRoot = outIndex === -1 ? repoRoot : path.resolve(process.argv[outIndex + 1]);
const work = mkdtempSync(path.join(tmpdir(), "woowtech-icons-"));

const BLUE_SYMBOL = SYMBOL_SOURCE;
const WHITE_SYMBOL = path.join(work, "symbol-white.svg");
writeFileSync(WHITE_SYMBOL, readFileSync(SYMBOL_SOURCE, "utf8").replaceAll(BRAND_BLUE, "#ffffff"));

// --- compositions (CSS on a MASTER-sized transparent canvas) -----------------

function symbol(src, widthPercent) {
  return `<img src="file://${src}" style="position:absolute;left:50%;top:50%;width:${widthPercent}%;transform:translate(-50%,-50%)">`;
}

function page(body) {
  return `<html><head><style>html,body{margin:0;background:transparent}</style></head><body><div style="position:relative;width:${MASTER}px;height:${MASTER}px">${body}</div></body></html>`;
}

/** A square tile, inset from the canvas edge, holding a centered symbol. */
function tile({ inset, radius, fill, border, shadow = "none", glyph, glyphWidth, dot }) {
  const size = MASTER - inset * 2;
  const borderCss = border ? `box-shadow:inset 0 0 0 ${Math.round(MASTER * 0.012)}px ${border}${shadow === "none" ? "" : `,${shadow}`};` : `box-shadow:${shadow};`;
  const dotHtml = dot
    ? `<div style="position:absolute;right:0;bottom:0;width:${MASTER * 0.36}px;height:${MASTER * 0.36}px;border-radius:50%;background:${dot}"></div>`
    : "";
  return page(
    `<div style="position:absolute;left:${inset}px;top:${inset}px;width:${size}px;height:${size}px;border-radius:${radius}px;background:${fill};${borderCss}">${symbol(glyph, glyphWidth)}</div>${dotHtml}`,
  );
}

const compositions = {
  // Full-bleed square: the launcher (iOS, Android legacy) applies its own mask.
  fullBleed: page(`<div style="position:absolute;inset:0;background:#ffffff">${symbol(BLUE_SYMBOL, 62)}</div>`),
  // Android adaptive icon foreground: the symbol inside the 66% safe zone.
  androidForeground: page(symbol(BLUE_SYMBOL, 40)),
  // Android notification icons are drawn as a white silhouette.
  notification: page(symbol(WHITE_SYMBOL, 84)),
  tile: tile({ inset: 20, radius: 230, fill: "#ffffff", border: TILE_BORDER, glyph: BLUE_SYMBOL, glyphWidth: 62 }),
  // Favicons show at 16-32px, so the symbol fills more of the tile.
  favicon: tile({ inset: 20, radius: 200, fill: "#ffffff", border: TILE_BORDER, glyph: BLUE_SYMBOL, glyphWidth: 76 }),
  faviconRunning: tile({ inset: 20, radius: 200, fill: "#ffffff", border: TILE_BORDER, glyph: BLUE_SYMBOL, glyphWidth: 76, dot: RUNNING_DOT }),
  faviconAttention: tile({ inset: 20, radius: 200, fill: "#ffffff", border: TILE_BORDER, glyph: BLUE_SYMBOL, glyphWidth: 76, dot: ATTENTION_DOT }),
  // macOS icon grid: an 824px tile inside the 1024px canvas, with a soft shadow.
  desktop: tile({ inset: 100, radius: 185, fill: "#ffffff", border: TILE_BORDER, shadow: "0 10px 22px rgba(26,29,41,0.18)", glyph: BLUE_SYMBOL, glyphWidth: 58 }),
  desktopDev: tile({ inset: 100, radius: 185, fill: BRAND_BLUE, shadow: "0 10px 22px rgba(26,29,41,0.18)", glyph: WHITE_SYMBOL, glyphWidth: 58 }),
};

function renderMaster(name) {
  const html = path.join(work, `${name}.html`);
  const png = path.join(work, `${name}.png`);
  writeFileSync(html, compositions[name]);
  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--default-background-color=00000000",
    `--window-size=${MASTER},${MASTER}`,
    `--screenshot=${png}`,
    `file://${html}`,
  ], { stdio: "ignore" });
  return png;
}

// --- PNG helpers ---------------------------------------------------------------

function resized(master, size) {
  const out = path.join(work, `${path.basename(master, ".png")}-${size}.png`);
  execFileSync("sips", ["-z", String(size), String(size), master, "--out", out], { stdio: "ignore" });
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
    writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), readFileSync(resized(master, size)));
    writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), readFileSync(resized(master, size * 2)));
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
  const masters = Object.fromEntries(Object.keys(compositions).map((name) => [name, renderMaster(name)]));
  const png = (master, size) => readFileSync(size === MASTER ? masters[master] : resized(masters[master], size));

  write("packages/app/assets/images/icon.png", withoutAlpha(masters.fullBleed));
  write("packages/app/assets/images/android-icon-foreground.png", png("androidForeground", MASTER));
  write("packages/app/assets/images/notification-icon.png", png("notification", 96));
  write("packages/app/assets/images/splash-icon.png", png("tile", 200));
  for (const name of ["favicon", "favicon-light", "favicon-dark"]) {
    write(`packages/app/assets/images/${name}.png`, png("favicon", 48));
  }
  for (const scheme of ["light", "dark"]) {
    write(`packages/app/assets/images/favicon-${scheme}-running.png`, png("faviconRunning", 48));
    write(`packages/app/assets/images/favicon-${scheme}-attention.png`, png("faviconAttention", 48));
  }
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
