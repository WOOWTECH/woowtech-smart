// woowtech smart must never take updates or installers from upstream Paseo.
// Upstream merges can bring back an upstream update source in a file we never
// touched, so these checks read the packaging config and the shipped sources
// directly.
//
//   node --test woowtech/update-sources.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findInShippedSources } from "./shipped-sources.mjs";

const repoRoot = new URL("../", import.meta.url);
const electronBuilderConfigPath = new URL("packages/desktop/electron-builder.yml", repoRoot);

const OUR_RELEASES = { provider: "github", owner: "WOOWTECH", repo: "woowtech-smart-releases" };
const UPSTREAM_DOWNLOAD_LINKS = [/github\.com\/getpaseo\/paseo\/releases/, /paseo\.sh\/download/];

/**
 * Every `publish:` in the file, including platform overrides, as flat key/value
 * maps. Inline and list forms (`publish: github`, `- provider: …`) come back in a
 * shape that cannot equal OUR_RELEASES, so they fail instead of slipping through.
 */
function publishBlocks(source) {
  const lines = source.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^(\s*)publish:\s*(.*?)\s*$/.exec(lines[index]);
    if (!header) continue;
    if (header[2] !== "") {
      blocks.push({ inline: header[2] });
      continue;
    }
    const block = {};
    for (let child = index + 1; child < lines.length; child += 1) {
      const entry = /^(\s*)([A-Za-z]+):\s*(.*?)\s*$/.exec(lines[child]);
      if (!entry || entry[1].length <= header[1].length) break;
      block[entry[2]] = entry[3];
    }
    blocks.push(block);
  }
  return blocks;
}

test("the desktop app looks for updates in our releases repo", () => {
  const blocks = publishBlocks(readFileSync(electronBuilderConfigPath, "utf8"));

  assert.ok(blocks.length > 0, "electron-builder.yml has no publish block");
  for (const block of blocks) {
    assert.deepEqual(block, OUR_RELEASES);
  }
});

test("shipped code links to our releases, not upstream's", () => {
  assert.deepEqual(findInShippedSources(UPSTREAM_DOWNLOAD_LINKS), []);
});
