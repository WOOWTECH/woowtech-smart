// The committed Traditional Chinese translations must be what the generator makes
// from upstream's current Simplified Chinese. When an upstream merge changes
// zh-CN.ts, this fails until zh-TW.ts is regenerated.
//
//   npm ci --prefix woowtech/tools   # once, for the OpenCC converter
//   node --test woowtech/zh-tw.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
