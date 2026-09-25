// woowtech smart installs its own agent skills. The official Paseo installs
// paseo, paseo-advisor, … into the same agent homes (~/.agents/skills,
// ~/.claude/skills, ~/.codex/skills), so ours are generated from upstream's
// skills/ under woowtech-smart* names and send agents to our command, daemon,
// app and help channels. These checks read the committed skills, because an
// upstream merge changes skills/ without regenerating woowtech/skills/.
//
//   npx tsx woowtech/tools/generate-skills.mjs   # after an upstream merge
//   node --test woowtech/skills.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const skillsDir = path.join(repoRoot, "woowtech", "skills");

const OUR_SKILLS = [
  "woowtech-smart",
  "woowtech-smart-advisor",
  "woowtech-smart-committee",
  "woowtech-smart-handoff",
  "woowtech-smart-help",
  "woowtech-smart-plugin",
];

function skillFiles(skill, dir = path.join(skillsDir, skill)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? skillFiles(skill, path.join(dir, entry.name))
      : [path.join(dir, entry.name)],
  );
}

function readSkill(skill) {
  return readFileSync(path.join(skillsDir, skill, "SKILL.md"), "utf8");
}

// Upstream's skills and the official Paseo app. Each points an agent at the
// other product: its port and daemon home, its app, its CLI, its skills or its
// help channels.
const UPSTREAM_LEFTOVERS = [
  /\b6767\b/,
  /(?:~|\$HOME|\/home\/[\w.-]+)\/\.paseo\b/,
  /\bPaseo\.app\b/,
  // The official app's folders, such as ~/Library/Logs/Paseo/.
  /[\\/]Paseo[\\/]/,
  // The paseo command. `paseo.agents`, `{ paseo }` and `requirements.paseo` are
  // the plugin API, which is upstream's.
  /(?<![\w.@/-])paseo(?= +(?:[a-z<]|-))/,
  /(?<![\w.@/-])\/?paseo-(?:advisor|chat|committee|epic|handoff|help|orchestrate|orchestrator|plugin)\b(?!\.json)/,
  /\*\*paseo\*\*|\bpaseo skill\b|^name: paseo\b|(?<=^|[\s`(])\/paseo(?![\w-]|\.\w)/,
  /discord/i,
  /github\.com\/getpaseo\/paseo\/(?:issues|discussions)|\bGitHub (?:Issues|Discussions)\b/i,
];
const UPSTREAM_LINK = /(?<![\w.-])paseo\.sh\b\S*|github\.com\/getpaseo\/\S*/g;
// The plugin API is upstream's, so the plugin skill keeps its docs and examples.
const PLUGIN_API_DOCS =
  /^(?:paseo\.sh\/(?:llms\.txt|docs\/(?:plugins|sdk)\b)|github\.com\/getpaseo\/paseo\/tree\/main\/plugin-examples\/)/;

test("the committed skills are what the generator makes from upstream's current skills", () => {
  const check = spawnSync("npx", ["tsx", "woowtech/tools/generate-skills.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test("woowtech smart ships its skills under its own names, never the official Paseo's", () => {
  const shipped = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(shipped, OUR_SKILLS);
  for (const skill of OUR_SKILLS) {
    assert.match(readSkill(skill), new RegExp(`^---\\nname: ${skill}\\n`), skill);
  }
});

test("skills do not send agents to the official Paseo", () => {
  const hits = [];
  for (const skill of OUR_SKILLS) {
    for (const file of skillFiles(skill)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const where = `${path.relative(repoRoot, file)}:${index + 1}`;
          if (UPSTREAM_LEFTOVERS.some((pattern) => pattern.test(line))) hits.push(where);
          for (const [link] of line.matchAll(UPSTREAM_LINK)) {
            if (skill === "woowtech-smart-plugin" && PLUGIN_API_DOCS.test(link)) continue;
            hits.push(`${where} ${link}`);
          }
        });
    }
  }
  assert.deepEqual(hits, []);
});

test("skills name our command, daemon, app and help channels", () => {
  const expectations = {
    "woowtech-smart": ["`woowtech-smart --help`", '"$PASEO_CLI"', "**woowtech-smart-help** skill"],
    "woowtech-smart-help": [
      "woowtech-smart daemon status --json",
      "http://127.0.0.1:6770/api/health",
      "`~/.woowtech-smart/daemon.log`",
      "`~/Library/Logs/woowtech smart/main.log`",
      "`/Applications/woowtech smart.app/Contents/Resources/bin/woowtech-smart`",
      '"$PASEO_CLI"',
      "woowtech-smart daemon pair --relay",
      "https://aiot.woowtech.io",
      "mailto:woowtech@designsmart.com.tw",
      "https://line.me/R/ti/p/@lwo6431z",
    ],
    "woowtech-smart-plugin": [
      "woowtech-smart plugin ls",
      '"$PASEO_CLI"',
      "https://paseo.sh/docs/plugins",
    ],
  };
  for (const [skill, texts] of Object.entries(expectations)) {
    const content = readSkill(skill);
    for (const text of texts) {
      assert.ok(content.includes(text), `${skill} should mention ${text}`);
    }
  }
});

test("the server's build ships woowtech/skills, not upstream's skills", () => {
  // build:lib copies the catalog into dist/server/skills, which the desktop app
  // packs and the daemon installs from. A daemon run from source reads
  // woowtech/skills itself (orchestration-skills/internal/paths.ts).
  const { scripts } = JSON.parse(
    readFileSync(path.join(repoRoot, "packages/server/package.json"), "utf8"),
  );
  assert.match(
    scripts["build:lib"],
    /fs\.cpSync\('\.\.\/\.\.\/woowtech\/skills','dist\/server\/skills',/,
  );
  assert.doesNotMatch(scripts["build:lib"], /'\.\.\/\.\.\/skills'/);
});

test("the rewriter keeps upstream's services and API but renames skill invocations", async () => {
  // Text upstream's skills may add later; today's skills cover the rest.
  const { createSkillRewriter } = await import("./tools/skill-rewrites.mjs");
  const rewriter = createSkillRewriter({
    cliCommand: "woowtech-smart",
    withCliCommand: (text) => text,
    brandSkillName: (name) => name.replace(/^paseo/, "woowtech-smart"),
    links: { docs: { home: "" }, supportEmail: "", lineOfficialAccount: "" },
    daemonHome: "~/.woowtech-smart",
    port: "6770",
    productName: "woowtech smart",
    upstreamSkills: ["paseo", "paseo-help", "paseo-plugin"],
  });
  assert.equal(
    rewriter.rewrite(
      "paseo-committee",
      "SKILL.md",
      "Run `/paseo` or /paseo-help. Paseo Hub and the Paseo SDK stay upstream's; Paseo is ours. Keep `/paseo-plugin.json`.",
    ),
    "Run `/woowtech-smart` or /woowtech-smart-help. Paseo Hub and the Paseo SDK stay upstream's; woowtech smart is ours. Keep `/paseo-plugin.json`.",
  );
});
