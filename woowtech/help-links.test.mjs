// woowtech smart sends people to WoowTech for help: the website for docs, email
// for problems, the LINE official account for community, and the releases repo
// for the changelog. The links live in packages/protocol/src/brand-links.ts.
// This check reads the shipped sources, because an upstream merge can bring back
// a link to Paseo's website, GitHub or Discord in a file we never touched.
//
//   node --test woowtech/help-links.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { findInShippedSources } from "./shipped-sources.mjs";

// Paseo's website. Its subdomains (app., hub., relay.) belong to the relay and
// change when we run our own.
const PASEO_WEBSITE = /(?<![\w.-])paseo\.sh\b/;
// Paseo's repository, raw files and its author's sponsor page.
const PASEO_GITHUB = /github(?:usercontent)?\.com\/(?:getpaseo|sponsors)\//;
const DISCORD_INVITE = /discord\.(?:gg|com\/invite)\//;

test("shipped code links to WoowTech, not to Paseo's website, GitHub or Discord", () => {
  const hits = findInShippedSources([PASEO_WEBSITE, PASEO_GITHUB, DISCORD_INVITE], {
    // The plugin API is still upstream's, so plugin authors keep Paseo's
    // plugin docs.
    skipPaths: ["packages/cli/src/commands/plugin/scaffold.ts"],
    allowLines: [/paseo\.sh\/docs\/plugins\//],
  });
  assert.deepEqual(hits, []);
});
