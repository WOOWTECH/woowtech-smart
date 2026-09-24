#!/usr/bin/env node
// Apply woowtech smart's build identity to the Expo app.
//
// WHY THIS EXISTS
// ---------------
// Three values in packages/app/app.config.js bind the build to the upstream
// author's Expo account (owner, slug, extra.eas.projectId). `eas build` resolves
// the project from those, so with the upstream values it either fails
// authorization or tries to write into someone else's project. A fourth value,
// packageId, becomes the iOS bundle identifier and the Android package name —
// "sh.paseo" already exists under another Apple team, so it cannot be reused.
//
// Everything else is left ALONE on purpose. This is a test build: the goal is a
// binary on a real device, not a finished rebrand. In particular `scheme` stays
// "paseo", because the daemon keeps a non-configurable CORS origin of
// "paseo://app" (bootstrap.ts fixedAllowedOrigins) and changing the scheme
// before the daemon side is rebranded turns every desktop request into a silent
// CORS 403. Rename the scheme in the same change that rebrands the daemon.
//
// Edits are exact string replacements, not line numbers: the upstream repo
// moves ~100 commits/week and line numbers drift within days.
//
// USAGE
//   EXPO_OWNER=<your expo username or org> \
//   EAS_PROJECT_ID=<uuid from expo.dev> \
//   EAS_SLUG=<your project slug> \
//   node woowtech/apply-identity.mjs
//
// Re-running is safe; already-applied edits are reported and skipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_CONFIG = path.join(root, "packages/app/app.config.js");

const OWNER = process.env.EXPO_OWNER?.trim();
const PROJECT_ID = process.env.EAS_PROJECT_ID?.trim();
const SLUG = process.env.EAS_SLUG?.trim() || "woowtech-smart";

const BUNDLE_ID = process.env.BUNDLE_ID?.trim() || "io.woowtech.smart";
const APP_NAME = process.env.APP_NAME?.trim() || "woowtech smart";

if (!OWNER || !PROJECT_ID) {
  console.error(`
Missing required values.

  EXPO_OWNER      your Expo account name
  EAS_PROJECT_ID  the project UUID

RUNNING IN A SIMULATOR? Neither value is used by a local \`expo run:ios\` /
\`expo run:android\` build — only \`eas build\` reads them. Pass placeholders:

  EXPO_OWNER=placeholder \\
  EAS_PROJECT_ID=00000000-0000-0000-0000-000000000000 \\
  node woowtech/apply-identity.mjs

BUILDING THROUGH EAS? Get the real values from \`eas login\` then \`eas init\`
inside packages/app, which creates the project and prints its id.

Optional overrides: EAS_SLUG (default woowtech-smart),
BUNDLE_ID (default io.woowtech.smart), APP_NAME (default "woowtech smart").
`);
  process.exit(1);
}

// Each entry: [description, exact source text, replacement]
const edits = [
  ["production display name", `name: "Paseo",`, `name: "${APP_NAME}",`],
  ["production bundle id", `packageId: "sh.paseo",`, `packageId: "${BUNDLE_ID}",`],
  ["debug display name", `name: "Paseo Debug",`, `name: "${APP_NAME} Debug",`],
  ["debug bundle id", `packageId: "sh.paseo.debug",`, `packageId: "${BUNDLE_ID}.debug",`],
  ["expo slug", `slug: "voice-mobile",`, `slug: "${SLUG}",`],
  [
    "eas project id",
    `projectId: "0e7f65ce-0367-46c8-a238-2b65963d235a",`,
    `projectId: "${PROJECT_ID}",`,
  ],
  ["expo owner", `owner: "getpaseo",`, `owner: "${OWNER}",`],
];

let source = fs.readFileSync(APP_CONFIG, "utf8");
let changed = 0;
let alreadyDone = 0;

for (const [label, from, to] of edits) {
  if (source.includes(to)) {
    console.log(`  = ${label} (already applied)`);
    alreadyDone += 1;
    continue;
  }
  const hits = source.split(from).length - 1;
  if (hits === 0) {
    console.error(`  ! ${label}: could not find \`${from}\``);
    console.error(`    Upstream moved. Open ${path.relative(root, APP_CONFIG)} and edit by hand.`);
    process.exit(1);
  }
  if (hits > 1) {
    console.error(`  ! ${label}: \`${from}\` appears ${hits} times; refusing to guess.`);
    process.exit(1);
  }
  source = source.replace(from, to);
  console.log(`  + ${label}`);
  changed += 1;
}

if (changed > 0) {
  fs.writeFileSync(APP_CONFIG, source);
}

console.log(`
${changed} applied, ${alreadyDone} already in place.

  app name      ${APP_NAME}
  bundle id     ${BUNDLE_ID}
  expo owner    ${OWNER}
  expo slug     ${SLUG}
  scheme        paseo   (deliberately unchanged — see the comment at the top)

Verify before building:
  cd packages/app && APP_VARIANT=production npx expo config --type public | head -20
`);
