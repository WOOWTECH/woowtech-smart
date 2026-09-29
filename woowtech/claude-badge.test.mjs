// woowtech smart shows Claude as a neutral text badge, the letter C in the caller's color
// inside a rounded square, and never Anthropic's Claude logo: Anthropic's terms let a product
// name Claude Code in plain text, but using the logo takes written permission. The owner chose
// the badge on 2026-09-27. An upstream merge can bring the logo back as a vendored ACP icon, a
// copied SVG or a new icon component, so this scans what ships in the app, its web page and
// the desktop app. Other vendors' logos are the owner's open decision and are not checked here.
// woowtech/README.md section 22.
//
//   node --test woowtech/claude-badge.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";
import { requireSource } from "./source-modules.mjs";

const SHIPPED_DIRS = [
  "packages/app/src",
  "packages/app/assets",
  "packages/app/public",
  "packages/app/plugins",
  "packages/desktop/src",
  "packages/desktop/assets",
  "packages/server/src",
  "packages/cli/src",
];
const SHIPPED_FILES = /\.(?:[cm]?[jt]sx?|json|svg|html|css|xml)$/;

// The start of each copy of the Claude logo's path data upstream has shipped: the app's
// provider icon (also on upstream's website) and the vendored claude-acp icon. Compared with
// whitespace and commas removed, so reformatting a copy does not hide it.
const CLAUDE_LOGO_PATHS = {
  "provider icon": "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073",
  "claude-acp icon": "M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647",
};
const squeeze = (text) => text.replace(/[\s,]+/g, "");

function* shippedFiles() {
  for (const dir of SHIPPED_DIRS) {
    yield* shippedSourceFiles(path.join(repoRoot, dir), SHIPPED_FILES);
  }
}

const relative = (file) => path.relative(repoRoot, file);

test("nothing the app, web page or desktop app ships draws Anthropic's Claude logo", () => {
  const found = [];
  for (const file of shippedFiles()) {
    const text = squeeze(readFileSync(file, "utf8"));
    for (const [copy, pathData] of Object.entries(CLAUDE_LOGO_PATHS)) {
      if (text.includes(squeeze(pathData))) found.push(`${relative(file)}: ${copy}`);
    }
  }
  assert.deepEqual(found, [], "Draw Claude with the text badge in claude-badge.ts instead.");
});

test("Claude icon files draw only in the caller's color, never Anthropic's orange", () => {
  // The badge takes the color the caller passes (the theme's foreground), so a Claude icon
  // file has no color of its own: no hex, rgb() or hsl() value such as Claude's #D97757.
  const iconFiles = [...shippedFiles()].filter(
    (file) =>
      /claude|anthropic/i.test(path.basename(file)) &&
      /[/\\](?:icons|assets|public)[/\\]/.test(relative(file)),
  );
  assert.ok(iconFiles.length >= 4, `the Claude icon files were not found: ${iconFiles}`);
  const colored = iconFiles.filter((file) =>
    /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(colored.map(relative), []);
});

test("every Claude icon the app renders is the text badge", () => {
  const badge = "packages/app/src/components/icons/claude-badge.ts";
  const { CLAUDE_BADGE_SVG } = requireSource(badge);
  const { ACP_PROVIDER_ICON_SVGS } = requireSource("packages/app/src/assets/acp-provider-icons.ts");
  const read = (file) => readFileSync(path.join(repoRoot, file), "utf8");

  assert.match(CLAUDE_BADGE_SVG, /<rect [^>]*rx="\d/, `${badge} has lost its rounded square`);
  assert.deepEqual(
    {
      "packages/app/assets/icons/claude.svg": read("packages/app/assets/icons/claude.svg"),
      "packages/app/src/assets/acp-provider-icons/claude-acp.svg": read(
        "packages/app/src/assets/acp-provider-icons/claude-acp.svg",
      ),
      'ACP_PROVIDER_ICON_SVGS["claude-acp"]': ACP_PROVIDER_ICON_SVGS["claude-acp"],
    },
    {
      "packages/app/assets/icons/claude.svg": CLAUDE_BADGE_SVG,
      "packages/app/src/assets/acp-provider-icons/claude-acp.svg": CLAUDE_BADGE_SVG,
      'ACP_PROVIDER_ICON_SVGS["claude-acp"]': CLAUDE_BADGE_SVG,
    },
  );
});
