// The shipped source files of the packages that make up woowtech smart, for the
// fork's guard tests. Tests, e2e suites and test utilities are left out.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const SHIPPED_SOURCE_DIRS = [
  "packages/app/src",
  "packages/cli/src",
  "packages/client/src",
  "packages/desktop/src",
  "packages/protocol/src",
  "packages/server/src",
];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json)$/;
const TEST_FILE = /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/;
const NOT_SHIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "test-utils",
  "e2e",
  "__tests__",
  "daemon-e2e",
]);

function* shippedSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!NOT_SHIPPED_DIRS.has(entry.name)) yield* shippedSourceFiles(path.join(dir, entry.name));
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

/** Every shipped source line that matches one of `patterns`, as `path:line`. */
export function findInShippedSources(patterns) {
  const hits = [];
  for (const dir of SHIPPED_SOURCE_DIRS) {
    for (const file of shippedSourceFiles(path.join(repoRoot, dir))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (patterns.some((pattern) => pattern.test(line))) {
            hits.push(`${path.relative(repoRoot, file)}:${index + 1}`);
          }
        });
    }
  }
  return hits;
}
