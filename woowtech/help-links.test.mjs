// woowtech smart sends people to WoowTech for help: the website for docs and
// community help, email for problems, and the releases repo for the changelog.
// The links live in packages/protocol/src/brand-links.ts. The owner retired the
// LINE official account as a help channel on 2026-09-26: every place that opened
// it now opens the website's home page.
// This check reads the shipped sources, because an upstream merge can bring back
// a link to Paseo's website, GitHub or Discord in a file we never touched.
//
//   node --test woowtech/help-links.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { findInShippedSources } from "./shipped-sources.mjs";

const repoRoot = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repoRoot), "utf8");

// Paseo's website. Its subdomains (app., hub., relay.) belong to the relay and
// change when we run our own.
const PASEO_WEBSITE = /(?<![\w.-])paseo\.sh\b/;
// Paseo's repository, raw files and its author's sponsor page.
const PASEO_GITHUB = /github(?:usercontent)?\.com\/(?:getpaseo|sponsors)\//;
const DISCORD_INVITE = /discord\.(?:gg|com\/invite)\//;
// LINE links in any form: line.me pages, lin.ee short links, and our account ID.
const LINE_LINK = /(?<![\w.-])line\.me\/|(?<![\w.-])lin\.ee\/|lwo6431z/i;

test("shipped code links to WoowTech, not to Paseo's website, GitHub or Discord", () => {
  const hits = findInShippedSources([PASEO_WEBSITE, PASEO_GITHUB, DISCORD_INVITE], {
    // The plugin API is still upstream's, so plugin authors keep Paseo's
    // plugin docs.
    skipPaths: ["packages/cli/src/commands/plugin/scaffold.ts"],
    allowLines: [/paseo\.sh\/docs\/plugins\//],
  });
  assert.deepEqual(hits, []);
});

// The agent skills we install for users (woowtech/skills/**), outside the
// package source folders findInShippedSources reads.
function skillFiles(dir = new URL("woowtech/skills/", repoRoot)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? skillFiles(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)],
  );
}

test("nothing shipped leads to the LINE official account", () => {
  assert.deepEqual(findInShippedSources([LINE_LINK]), []);
  const skillHits = skillFiles()
    .filter((file) => LINE_LINK.test(readFileSync(file, "utf8")))
    .map((file) => file.pathname.slice(new URL(repoRoot).pathname.length));
  assert.deepEqual(skillHits, []);
});

test("the help menu and the community button open the website's home page", () => {
  const links = read("packages/protocol/src/brand-links.ts");
  assert.match(links, /const WEBSITE = `https:\/\/\$\{WEBSITE_HOST\}`;/);
  assert.match(links, /const WEBSITE_HOST = "aiot\.woowtech\.io";/);

  const helpMenu = read("packages/app/src/components/sidebar/sidebar-help-menu.tsx");
  assert.match(helpMenu, /openExternalUrl\(BRAND_LINKS\.website\)/);

  const communityLinks = read("packages/app/src/components/community-links.tsx");
  assert.match(communityLinks, /openExternalUrl\(BRAND_LINKS\.website\)/);

  // The item's label names the website in every language, not LINE.
  assert.doesNotMatch(read("packages/app/src/i18n/support-copy.ts"), /LINE/);
});

// Apple (App Store Review Guideline 5.1.1) and Google Play want the privacy policy reachable
// inside the app as well as in the store listing. It is a Help Center post on the website.
test("Settings > About opens the privacy policy on the website", () => {
  const links = read("packages/protocol/src/brand-links.ts");
  assert.match(links, /privacyPolicy: `\$\{WEBSITE\}\/blog\/help-center-7\/[a-z0-9-]+-391`,/);
  const row = read("packages/app/src/screens/settings/woowtech-privacy-policy-row.tsx");
  assert.match(row, /openExternalUrl\(BRAND_LINKS\.privacyPolicy\)/);
  const settings = read("packages/app/src/screens/settings-screen.tsx");
  assert.match(settings, /<WhatsNewRow \/>[\s\S]{0,200}<WoowtechPrivacyPolicyRow \/>/);
});
