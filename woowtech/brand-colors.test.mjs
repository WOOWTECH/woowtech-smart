// woowtech smart highlights in the brand blue #6183fc (packages/app/src/styles/brand.ts).
// Upstream Paseo's brand green must not come back through a merge, in the app, the web
// page around it (which the desktop app also loads) or the desktop wrapper. Greens that
// mean something, such as success, added lines or a running script, use other values
// and stay.
//
//   node --test woowtech/brand-colors.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { findInShippedSources } from "./shipped-sources.mjs";

// Upstream's brand green, the lighter steps its themes highlighted with (light, dark),
// and the swatch that stood for its default dark theme.
const UPSTREAM_BRAND_GREENS = ["#20744a", "#239956", "#7ccba0", "#2d8b62"];

/** A color written as hex (with or without alpha) or as rgb()/rgba(). */
function colorPatterns(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  );
  return [new RegExp(hex, "i"), new RegExp(`rgba?\\(\\s*${red}[\\s,]+${green}[\\s,]+${blue}\\b`)];
}

test("shipped app, web and desktop files never use Paseo's brand green", () => {
  const hits = findInShippedSources(UPSTREAM_BRAND_GREENS.flatMap(colorPatterns), {
    dirs: [
      "packages/app/src",
      "packages/app/public",
      "packages/desktop/src",
      "packages/desktop/assets",
    ],
    files: ["packages/app/app.config.js", "packages/desktop/electron-builder.yml"],
    fileTypes: /\.(?:[cm]?[jt]sx?|json|html|css|svg)$/,
  });

  assert.deepEqual(hits, []);
});
