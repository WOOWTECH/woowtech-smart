// The brand layer: one codebase builds woowtech smart and Apporo smart (woowtech/README.md §30).
// Each brand is a JSON file in woowtech/brands; woowtech/tools/apply-brand.mjs writes one into
// packages/protocol/src/brand-values.ts and the files in woowtech/brands/apply.mjs. These checks
// keep the brands complete, apart from each other and from upstream Paseo, and keep the
// repository on woowtech. In a release tree with another brand applied, run them with
// WOOWTECH_BRAND=<id>; they then also check that nothing woowtech's is left in what ships.
//
//   node --test woowtech/brand-layer.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BRANDED_FILES,
  ELECTRON_BUILDER_CONFIG,
  brandElectronBuilderConfig,
} from "./brands/apply.mjs";
import { appliedBrandId, brandIds, loadBrand, renderBrandValues } from "./brands/index.cjs";
import { findInShippedSources } from "./shipped-sources.mjs";
import { importSource } from "./source-modules.mjs";

const repoRoot = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, repoRoot), "utf8");

const brands = brandIds().map(loadBrand);
const applied = loadBrand(appliedBrandId());

// Upstream Paseo's values for what each brand must have of its own: an install of the official
// Paseo on the same computer or phone keeps working next to ours.
const UPSTREAM = {
  name: "Paseo",
  scheme: "paseo",
  cliCommand: "paseo",
  homeDir: "~/.paseo",
  defaultPort: 6767,
  desktopAppId: "sh.paseo.desktop",
};

/** The fields two installs on one machine must not share, as `field → value`. */
function coexistenceValues(brand) {
  return {
    name: brand.name,
    scheme: brand.scheme,
    cliCommand: brand.cliCommand,
    homeDir: brand.homeDir,
    defaultPort: brand.defaultPort,
    mobileAppId: brand.mobileAppId,
    mobileAppIdDebug: brand.mobileAppIdDebug,
    mobileSecretsDir: brand.mobileSecretsDir,
    desktopAppId: brand.desktop.appId,
    artifactPrefix: brand.desktop.artifactPrefix,
    releasesRepo: brand.links.releasesRepo,
    relayHost: brand.services.relayHost,
    pushRelayUrl: brand.services.pushRelayUrl,
    aiContentReportUrl: brand.services.aiContentReportUrl,
  };
}

/** Every key path of `value`: "desktop.appId", … */
function keyPaths(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === "object" && !Array.isArray(child)
      ? keyPaths(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

test("the repository builds woowtech smart unless WOOWTECH_BRAND names the applied brand", () => {
  assert.equal(appliedBrandId(), process.env.WOOWTECH_BRAND ?? "woowtech");
});

test("brand-values.ts holds the applied brand's JSON, as the generator writes it", async () => {
  const generated = await importSource("packages/protocol/src/brand-values.ts");
  assert.equal(generated.BRAND_ID, applied.id);
  assert.deepEqual(generated.BRAND, applied);
  // The generator's output, before the formatter, declares the same values.
  assert.match(renderBrandValues(applied), /^export const BRAND_ID = "[a-z][a-z0-9-]*";$/m);
});

test("every brand has the same fields, filled in", () => {
  const expected = keyPaths(loadBrand("woowtech")).sort();
  for (const brand of brands) {
    assert.deepEqual(keyPaths(brand).sort(), expected, `${brand.id}.json has other fields`);
    for (const key of keyPaths(brand)) {
      const value = key.split(".").reduce((node, part) => node[part], brand);
      assert.ok(value !== "" && value !== null, `${brand.id}: ${key} is empty`);
    }
  }
});

test("brand values have the shapes the code relies on", () => {
  for (const brand of brands) {
    // The scheme goes into regular expressions unescaped (diagnostics redaction).
    assert.match(brand.scheme, /^[a-z][a-z0-9-]*$/, `${brand.id}: scheme`);
    assert.match(brand.cliCommand, /^[a-z][a-z0-9-]*$/, `${brand.id}: cliCommand`);
    assert.match(brand.homeDir, /^~\/\.[a-z][a-z0-9-]*$/, `${brand.id}: homeDir`);
    assert.ok(Number.isInteger(brand.defaultPort), `${brand.id}: defaultPort`);
    for (const id of [brand.mobileAppId, brand.mobileAppIdDebug, brand.desktop.appId]) {
      assert.match(id, /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/, `${brand.id}: ${id}`);
    }
    assert.ok(brand.mobileAppIdDebug.startsWith(`${brand.mobileAppId}.`), `${brand.id}: debug id`);
    // iOS cuts longer home-screen names (woowtech/names.test.mjs checks the built ones).
    assert.ok(brand.name.length <= 15 && brand.nameZh.length <= 15, `${brand.id}: name length`);
    assert.match(brand.desktop.artifactPrefix, /^[a-z][a-z0-9-]*$/, `${brand.id}: artifactPrefix`);
    assert.match(brand.links.websiteHost, /^[a-z0-9.-]+$/, `${brand.id}: websiteHost`);
    assert.match(brand.links.releasesRepo, /^[\w.-]+\/[\w.-]+$/, `${brand.id}: releasesRepo`);
    for (const url of [
      brand.links.privacyPolicy,
      brand.links.privacyPolicyZh,
      brand.services.pushRelayUrl,
      brand.services.aiContentReportUrl,
    ]) {
      assert.ok(url.startsWith("https://"), `${brand.id}: ${url}`);
    }
    const { logo } = brand;
    for (const color of [
      ...Object.values(brand.colors),
      logo.color,
      logo.colorOnDark,
      logo.tileColor,
      logo.badgeRing,
    ]) {
      assert.match(color, /^#[0-9a-fA-F]{6}$/, `${brand.id}: color ${color}`);
    }
    assert.ok(["mark", "badge"].includes(logo.style), `${brand.id}: logo.style`);
    assert.equal(logo.viewBox.split(/\s+/).map(Number).filter(Number.isFinite).length, 4);
    assert.ok(
      logo.paths.every((d) => /^M\s*-?\d/.test(d)),
      `${brand.id}: logo.paths`,
    );
    for (const [kind, width] of Object.entries(logo.markWidths)) {
      assert.ok(width > 0 && width <= 100, `${brand.id}: markWidths.${kind}`);
    }
    // Android masks the adaptive icon to a circle 66% of the canvas wide; a mark wider than about
    // half the canvas loses its corners.
    assert.ok(logo.markWidths.androidForeground <= 48, `${brand.id}: Android foreground too wide`);
  }
});

test("each brand installs next to upstream Paseo and next to the other brands", () => {
  for (const brand of brands) {
    const values = coexistenceValues(brand);
    for (const [field, upstream] of Object.entries(UPSTREAM)) {
      if (field in values) assert.notEqual(values[field], upstream, `${brand.id}: ${field}`);
    }
    assert.notEqual(brand.desktop.appId, UPSTREAM.desktopAppId, `${brand.id}: desktop appId`);
  }
  for (const [index, brand] of brands.entries()) {
    for (const other of brands.slice(index + 1)) {
      const ours = coexistenceValues(brand);
      const theirs = coexistenceValues(other);
      for (const field of Object.keys(ours)) {
        assert.notEqual(ours[field], theirs[field], `${brand.id} and ${other.id} share ${field}`);
      }
    }
  }
});

test("the branded files and electron-builder.yml carry the applied brand's values", () => {
  for (const file of BRANDED_FILES) {
    const text = read(file.path);
    for (const key of file.values) {
      const value = key.split(".").reduce((node, part) => node[part], applied);
      assert.ok(text.includes(value), `${file.path} lacks ${key} "${value}"`);
    }
  }
  // Writing the applied brand into electron-builder.yml again changes nothing, so every field
  // apply.mjs sets holds the brand's value already.
  const config = read(ELECTRON_BUILDER_CONFIG);
  assert.equal(brandElectronBuilderConfig(config, applied), config);
});

/** Words and values that name each brand, which must not reach another brand's build. */
const BRAND_MARKS = {
  woowtech: [
    /woowtech smart/i,
    /woowtech-smart/,
    /渥屋/,
    /\bio\.woowtech\b/,
    /woowtech\.io\b/,
    /#6183fc/i,
    /WOOW TECH/,
    /designsmart/,
    /WoowTech/,
  ],
  apporo: [/apporo/i],
};

test("nothing that ships names another brand", () => {
  for (const [id, marks] of Object.entries(BRAND_MARKS)) {
    if (id === applied.id) continue;
    const hits = findInShippedSources(marks, {
      skipComments: true,
      // Translations upstream ships, which the app renames as they load.
      skipPaths: ["packages/app/src/i18n/resources/"],
    });
    assert.deepEqual(hits, [], `${applied.id}'s shipped sources name ${id}`);
  }
});
