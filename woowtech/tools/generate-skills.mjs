// Generates woowtech smart's agent skills (woowtech/skills/) from upstream's
// (skills/). The official Paseo installs its skills into the same agent homes
// as ours (~/.agents/skills, ~/.claude/skills, ~/.codex/skills), so ours are
// named woowtech-smart* and send agents to our command, daemon, app and help
// channels. The rewrites are in skill-rewrites.mjs; the output is formatted the
// way the pre-commit hook checks it.
//
//   npx tsx woowtech/tools/generate-skills.mjs           # write woowtech/skills/
//   npx tsx woowtech/tools/generate-skills.mjs --check   # fail when woowtech/skills/ is stale
//
// Re-run after any upstream merge that touches skills/: woowtech/skills.test.mjs
// fails until woowtech/skills/ matches.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_COMMAND, withCliCommand } from "../../packages/protocol/src/brand-cli.ts";
import { BRAND_LINKS } from "../../packages/protocol/src/brand-links.ts";
import { brandSkillName } from "../../packages/protocol/src/brand-skills.ts";
import { DEFAULT_PASEO_HOME } from "../../packages/server/src/server/paseo-home.ts";
import { createSkillRewriter } from "./skill-rewrites.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const upstreamDir = path.join(repoRoot, "skills");
const outputDir = path.join(repoRoot, "woowtech", "skills");
const oxfmt = path.join(repoRoot, "node_modules", ".bin", "oxfmt");
// The desktop app's name, which also names its .app bundle and log folders.
const PRODUCT_NAME = "woowtech smart";

/** The daemon's default port, as packages/server/src/server/config.ts sets it. */
function daemonPort() {
  const config = readFileSync(path.join(repoRoot, "packages/server/src/server/config.ts"), "utf8");
  const match = /^const DEFAULT_PORT = (\d+);$/m.exec(config);
  if (!match) throw new Error("DEFAULT_PORT not found in packages/server/src/server/config.ts");
  return match[1];
}

/** Every file under `dir`, as sorted paths relative to it. */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

function format(outputPath, text) {
  const result = spawnSync(oxfmt, [`--stdin-filepath=${outputPath}`], {
    cwd: repoRoot,
    input: text,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`oxfmt could not format ${outputPath}:\n${result.stderr}`);
  }
  return result.stdout;
}

/** woowtech/skills/ as generated from skills/: path inside it → contents. */
function generate() {
  const upstreamSkills = readdirSync(upstreamDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const rewriter = createSkillRewriter({
    cliCommand: CLI_COMMAND,
    withCliCommand,
    brandSkillName,
    links: BRAND_LINKS,
    daemonHome: DEFAULT_PASEO_HOME,
    port: daemonPort(),
    productName: PRODUCT_NAME,
    upstreamSkills,
  });
  const files = new Map();
  for (const skill of upstreamSkills) {
    for (const file of listFiles(path.join(upstreamDir, skill))) {
      const source = readFileSync(path.join(upstreamDir, skill, file));
      const target = path.join(brandSkillName(skill), file);
      files.set(
        target,
        file.endsWith(".md")
          ? Buffer.from(
              format(
                path.join("woowtech", "skills", target),
                rewriter.rewrite(skill, file, source.toString("utf8")),
              ),
            )
          : source,
      );
    }
  }
  rewriter.assertEveryRuleApplied();
  return files;
}

function committed() {
  const files = new Map();
  if (!existsSync(outputDir)) return files;
  for (const file of listFiles(outputDir)) {
    files.set(file, readFileSync(path.join(outputDir, file)));
  }
  return files;
}

const generated = generate();

if (process.argv.includes("--check")) {
  const current = committed();
  const stale = [...new Set([...generated.keys(), ...current.keys()])].filter((file) => {
    const expected = generated.get(file);
    const actual = current.get(file);
    return !expected || !actual || !expected.equals(actual);
  });
  if (stale.length > 0) {
    console.error(
      `woowtech/skills is out of date: ${stale.sort().join(", ")}\n` +
        "Run: npx tsx woowtech/tools/generate-skills.mjs",
    );
    process.exit(1);
  }
  console.log("woowtech/skills is up to date");
} else {
  rmSync(outputDir, { recursive: true, force: true });
  for (const [file, contents] of generated) {
    mkdirSync(path.dirname(path.join(outputDir, file)), { recursive: true });
    writeFileSync(path.join(outputDir, file), contents);
  }
  console.log(`wrote ${generated.size} files to woowtech/skills`);
}
