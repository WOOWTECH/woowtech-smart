// Merge guards for the Windows daemon (README §25, G11). The daemon has no console of its
// own, so on Windows a console-subsystem child started without windowsHide flashes a console
// window. A new upstream fork() or spawn() fails here until it hides its window.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Development-only launchers that never run inside the packaged daemon.
const DEV_ONLY = new Set(["packages/server/scripts/dev-runner.ts"]);

function sourceFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|mts)$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((file) => !/\.(test|spec)\.|[\\/](test-utils|daemon-e2e|e2e)[\\/]/.test(file))
    .filter((file) => !DEV_ONLY.has(file));
}

// Blank out comments, keeping line numbers, so documentation about spawn() is not a call.
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`])\/\/[^\n]*/g,
      (comment, lead) => lead + " ".repeat(comment.length - lead.length),
    );
}

function callArguments(text, openParen) {
  let depth = 0;
  for (let index = openParen; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openParen, index + 1);
    }
  }
  return text.slice(openParen);
}

test("every daemon fork() and direct spawn() hides its window", () => {
  const missing = [];
  for (const file of [
    ...sourceFiles("packages/server/src"),
    ...sourceFiles("packages/server/scripts"),
  ]) {
    const text = withoutComments(readFileSync(join(root, file), "utf8"));
    for (const match of text.matchAll(/(?<![\w.])(fork|spawn)\(/g)) {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      if (/function\s*$|import[^;]*$/.test(before)) continue;
      const call = callArguments(text, match.index + match[1].length);
      // spawn(launch) style calls hand a prepared launch to an injected spawner.
      if (!call.includes(",")) continue;
      if (!call.includes("windowsHide: true") && !call.includes("withHiddenWindow(")) {
        missing.push(`${file}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("process trees are killed through the hidden taskkill wrapper", () => {
  const offenders = sourceFiles("packages/server/src").filter((file) =>
    /from "tree-kill"/.test(readFileSync(join(root, file), "utf8")),
  );
  assert.deepEqual(offenders, ["packages/server/src/utils/woowtech-process-tree-kill.ts"]);
  const wrapper = readFileSync(
    join(root, "packages/server/src/utils/woowtech-process-tree-kill.ts"),
    "utf8",
  );
  assert.match(wrapper, /\["\/pid", String\(pid\), "\/T", "\/F"\],\s*\{ windowsHide: true \}/);
});
