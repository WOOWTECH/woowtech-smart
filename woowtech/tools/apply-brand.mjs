// Switches a woowtech checkout to another brand in woowtech/brands before a release build:
//
//   node woowtech/tools/apply-brand.mjs apporo
//
// It regenerates packages/protocol/src/brand-values.ts, which the TypeScript packages and
// woowtech/brands/index.cjs read, and writes the brand into the files listed in
// woowtech/brands/apply.mjs. Run it in a release tree, never in a checkout you commit from: the
// repository keeps woowtech's files, and woowtech/brand-layer.test.mjs fails while another brand
// is applied unless WOOWTECH_BRAND names it. `git checkout .` goes back to woowtech.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { applyBrandToFiles } from "../brands/apply.mjs";

const require = createRequire(import.meta.url);
const {
  BRAND_VALUES_PATH,
  REPO_ROOT,
  appliedBrandId,
  brandIds,
  loadBrand,
  renderBrandValues,
} = require("../brands/index.cjs");

/** Formats `files` the way the pre-commit hook checks them. */
function format(files) {
  const oxfmt = path.join(REPO_ROOT, "node_modules", ".bin", "oxfmt");
  if (!existsSync(oxfmt)) {
    console.warn(`${oxfmt} is missing (run npm ci); left unformatted: ${files.join(", ")}`);
    return;
  }
  const result = spawnSync(oxfmt, files, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`oxfmt failed on ${files.join(", ")}`);
  }
}

const id = process.argv[2];
if (!id || !brandIds().includes(id)) {
  console.error(`usage: node woowtech/tools/apply-brand.mjs <${brandIds().join("|")}>`);
  process.exit(2);
}

const current = appliedBrandId();
if (current === id) {
  writeFileSync(BRAND_VALUES_PATH, renderBrandValues(loadBrand(id)));
  format([BRAND_VALUES_PATH]);
  console.log(
    `Brand ${id} is already applied; regenerated ${path.relative(REPO_ROOT, BRAND_VALUES_PATH)}`,
  );
  process.exit(0);
}
if (current !== "woowtech") {
  console.error(`This checkout has brand ${current} applied. Restore it first: git checkout .`);
  process.exit(1);
}

writeFileSync(BRAND_VALUES_PATH, renderBrandValues(loadBrand(id)));
format([BRAND_VALUES_PATH]);
const files = applyBrandToFiles(REPO_ROOT, loadBrand(current), loadBrand(id));
console.log(`Applied brand ${id}:`);
for (const file of [path.relative(REPO_ROOT, BRAND_VALUES_PATH), ...files]) {
  console.log(`  ${file}`);
}
