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
  const check = spawnSync("npx", ["tsx", "woowtech/tools/generate-zh-tw.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
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
const MISSPELLED_NAMED_TERM = new RegExp(WORD("agents?|hosts?|Agents|Hosts|apps?"));

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
