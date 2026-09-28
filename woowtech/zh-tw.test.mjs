// The committed Traditional Chinese translations must be what the generator makes
// from upstream's current Simplified Chinese. When an upstream merge changes
// zh-CN.ts, this fails until zh-TW.ts is regenerated.
//
//   npm ci --prefix woowtech/tools   # once, for the OpenCC converter
//   node --test woowtech/zh-tw.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { asWord, fixTerms } from "./tools/zh-tw-terms.mjs";
import { KEEP_ENGLISH } from "./tools/zh-tw-untranslated.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

test("Traditional Chinese is regenerated from upstream's current Simplified Chinese", () => {
  assert.ok(
    existsSync(new URL("tools/node_modules/opencc-js", import.meta.url)),
    "OpenCC is not installed: run npm ci --prefix woowtech/tools",
  );
  const check = spawnSync(
    "npx",
    ["--no-install", "tsx", "woowtech/tools/generate-zh-tw.mjs", "--check"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

/** The committed zh-TW strings by key. The file is one object literal of strings. */
function committedTraditional() {
  const source = readFileSync(
    new URL("../packages/app/src/i18n/resources/zh-TW.ts", import.meta.url),
    "utf8",
  );
  const literal = source.slice(source.indexOf("= {") + 2, source.lastIndexOf(";"));
  return flatten(vm.runInNewContext(`(${literal})`));
}

function flatten(value, path = "", strings = new Map()) {
  if (typeof value === "string") {
    strings.set(path, value);
    return strings;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, path ? `${path}.${key}` : key, strings);
  }
  return strings;
}

const HAN = /[㐀-鿿]/;
// A word of the sentence, as zh-tw-terms.mjs finds one: a word inside a path, file
// name, command or {{placeholder}} is not one.
const WORD = asWord;
// Common nouns zh-tw-terms.mjs gives a Taiwanese term, in any case and number.
const ENGLISH_NOUN = new RegExp(
  WORD(
    [
      "projects?",
      "workspaces?",
      "providers?",
      "servers?",
      "hosts?",
      "terminals?",
      "models?",
      "scripts?",
      "clients?",
      "relays?",
      "repository",
      "repositories",
      "branch(?:es)?",
      "remotes?",
      "modes?",
      "features?",
      "thinking",
      "runtimes?",
      "prompts?",
      "sub-?agents?",
      "reviews?",
      "drafts?",
      "skills?",
      "tools",
      "commands",
      "setup",
      "teardown",
      "realtime",
      "voice",
      "turn",
    ].join("|"),
  ),
  "i",
);
// The named terms stay English, capitalized and singular as Chinese has no plural.
const MISSPELLED_NAMED_TERM = new RegExp(WORD("agents?|Agents|apps?"));

// A label upstream left as just one of those words.
const ENGLISH_LABEL = new RegExp(`^(?:${ENGLISH_NOUN.source})$`, "i");
const MISSPELLED_LABEL = new RegExp(`^(?:${MISSPELLED_NAMED_TERM.source})$`);

test("Traditional Chinese uses Taiwanese terms, not English nouns", () => {
  const english = [...committedTraditional()].filter(([, text]) => {
    const words = text.replace(/\{\{[^}]*\}\}/g, " ");
    if (!HAN.test(words)) {
      return ENGLISH_LABEL.test(words.trim()) || MISSPELLED_LABEL.test(words.trim());
    }
    return ENGLISH_NOUN.test(words) || MISSPELLED_NAMED_TERM.test(words);
  });
  assert.deepEqual(english, []);
});

// Upstream's Simplified Chinese can name a file or a host inside a sentence. Those are
// names, and a term there breaks them: app.paseo.sh would read App.paseo.sh.
test("the term fixes leave file and domain names alone", () => {
  const context = { key: "", english: "" };
  for (const text of [
    "開啟 app.paseo.sh 完成配對",
    "編輯 agents.md 檔案",
    "請檢查 project.json",
    "執行 setup.sh 腳本",
  ]) {
    assert.equal(fixTerms(text, context), text);
  }
  // The same word still takes its term before an ellipsis or at the end of a sentence.
  assert.equal(fixTerms("正在載入 workspace...", context), "正在載入工作區...");
  assert.equal(fixTerms("新增 project.", context), "新增專案.");
});

// A string with no Chinese at all is one upstream's Simplified Chinese left in
// English; tools/zh-tw-untranslated.mjs translates it or keeps it on purpose.
test("Traditional Chinese has no English string left over from upstream", () => {
  const english = [...committedTraditional()].filter(([key, text]) => {
    const words = text.replace(/\{\{[^}]*\}\}/g, " ");
    return !HAN.test(words) && /[A-Za-z]{2}/.test(words) && !KEEP_ENGLISH.has(key);
  });
  assert.deepEqual(english, []);
});

// No UI Host exceptions: technical identifiers and interpolation values are not prose.
test("Host UI terminology is 主機 while Agent and technical strings are preserved", () => {
  const remaining = [...committedTraditional()].filter(([, text]) =>
    new RegExp(asWord("hosts?"), "i").test(text.replace(/\{\{[^}]*\}\}/g, " ")),
  );
  assert.deepEqual(remaining, []);
  const context = { key: "", english: "" };
  assert.equal(fixTerms("Host", context), "主機");
  assert.equal(fixTerms("選擇 Host 和 hosts", context), "選擇主機和主機");
  assert.equal(fixTerms("Agent", context), "Agent");
  for (const text of [
    "localhost",
    "hostname",
    "--host",
    "https://host.example/host",
    "{{host}}",
    "連線至 localhost、hostname，執行 --host {{host}}",
    "開啟 https://host.example/host 和 /host/file、host.json、`host`",
  ]) {
    assert.equal(fixTerms(text, context), text);
  }
});

test("confirm dialog and subagent actions keep localized defaults and caller overrides", () => {
  const source = readFileSync(
    new URL("../packages/app/src/utils/confirm-dialog.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /cancelLabel: input.cancelLabel \?\? i18n.t\("common.actions.cancel"\)/);
  assert.equal((source.match(/resolveButtonLabels\(input\)/g) ?? []).length, 2);
  assert.match(source, /ports: ConfirmDialogPorts = \{ getDesktopHost \}/);
  assert.match(
    source,
    /confirmLabel: input.confirmLabel \?\? i18n.t\("woowtech.confirmDialog.confirm"\)/,
  );
  for (const file of ["archive-subagent", "detach-subagent"]) {
    const subagent = readFileSync(
      new URL(`../packages/app/src/subagents/${file}.ts`, import.meta.url),
      "utf8",
    );
    assert.match(subagent, /cancelLabel: i18n.t\("common.actions.cancel"\)/);
  }
  assert.equal(committedTraditional().get("common.actions.cancel"), "取消");
});

// Screens upstream hardcodes in English that read woowtech.* translations instead (README
// section 14). An upstream merge that adds English text to them fails here until it does too.
const TRANSLATED_SCREENS = [
  "packages/app/src/screens/schedules-screen.tsx",
  "packages/app/src/components/schedules/schedule-row.tsx",
  "packages/app/src/components/schedules/schedules-table.tsx",
  "packages/app/src/components/schedules/cadence-editor.tsx",
  "packages/app/src/components/schedules/schedule-form-sheet.tsx",
];
const HARDCODED_ENGLISH = [
  // JSX text: words after a tag (not an arrow), up to the next tag or expression.
  /(?<=[^=]>)[^\S\n]*\n?\s*[A-Za-z][^<>{}\n]*[A-Za-z.!?…](?=\s*[<{])/g,
  // Text props people read or hear.
  /\b(?:label|title|placeholder|searchPlaceholder|emptyText|hint|accessibilityLabel|pendingLabel|confirmLabel|cancelLabel|message|description)=["'][^"']*[A-Za-z]{2}[^"']*["']/g,
  // Option and header objects.
  /\b(?:label|title|message|placeholder|description):\s*["'`][^"'`]*[A-Za-z]{2}[^"'`]*["'`]/g,
  // A phrase of English words in a string literal.
  /(["'])[A-Z][a-z]+(?: [A-Za-z][a-z-]*)+[.?!…]*\1/g,
  // A template literal that starts with an English word.
  /`[A-Z][a-z]+ [^`\n]*`?/g,
  // English words after an interpolation, before the template literal closes on that line.
  /\}[^`$\n]*\b[a-z]{2,} [a-z]{2,}[^`$\n]*`/g,
];

/** Code without comments, which are prose for developers. Line numbers stay the same. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (comment, before) => before.padEnd(comment.length, " "));
}

function hardcodedEnglish(source) {
  const code = withoutComments(source);
  return HARDCODED_ENGLISH.flatMap((pattern) =>
    [...code.matchAll(pattern)].map(
      (match) => `${code.slice(0, match.index).split("\n").length}: ${match[0].trim()}`,
    ),
  );
}

test("the translated schedule screens have no hardcoded English", () => {
  const found = TRANSLATED_SCREENS.flatMap((file) =>
    hardcodedEnglish(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).map(
      (hit) => `${file}:${hit}`,
    ),
  );
  assert.deepEqual(found, []);
  // The patterns find the shapes upstream wrote before these screens were translated.
  const upstreamShapes = [
    "<Text style={styles.message}>Unable to load schedules</Text>",
    '<Field label="Cadence">',
    '{ value: "ended", label: "Ended" },',
    '{mode === "edit" ? "Save changes" : "Create schedule"}',
    "`Created ${formatTimeAgo(date)}`,",
    "{`${error.serverName}: Could not load schedules`}",
    "        >",
    "          Edit {productNameLower}",
  ];
  assert.deepEqual(
    hardcodedEnglish(upstreamShapes.join("\n"))
      .map((hit) => hit.replace(/^\d+: /, ""))
      .sort(),
    [
      '"Create schedule"',
      '"Save changes"',
      "Edit",
      "Unable to load schedules",
      "`Created ${formatTimeAgo(date)}`",
      'label: "Ended"',
      'label="Cadence"',
      "}: Could not load schedules`",
    ],
  );
});
