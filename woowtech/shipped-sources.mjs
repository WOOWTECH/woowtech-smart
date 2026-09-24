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

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\{\/\*|<!--)/;

function* shippedSourceFiles(dir, fileTypes) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!NOT_SHIPPED_DIRS.has(entry.name)) {
        yield* shippedSourceFiles(path.join(dir, entry.name), fileTypes);
      }
    } else if (fileTypes.test(entry.name) && !TEST_FILE.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

/**
 * Every shipped source line that matches one of `patterns`, as `path:line`.
 *
 * Options narrow the search: `dirs` to scan instead of every package, `fileTypes`
 * to read, `skipPaths` (prefixes relative to the repo root), `skipComments`, and
 * `allowLines` for individual lines that may match, each with a stated reason at
 * the call site.
 */
export function findInShippedSources(patterns, options = {}) {
  const {
    dirs = SHIPPED_SOURCE_DIRS,
    fileTypes = SOURCE_FILE,
    skipPaths = [],
    skipComments = false,
    allowLines = [],
  } = options;
  const hits = [];
  for (const dir of dirs) {
    for (const file of shippedSourceFiles(path.join(repoRoot, dir), fileTypes)) {
      const relativeFile = path.relative(repoRoot, file);
      if (skipPaths.some((skipped) => relativeFile.startsWith(skipped))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (skipComments && COMMENT_LINE.test(line)) return;
          if (allowLines.some((allowed) => allowed.test(line))) return;
          if (patterns.some((pattern) => pattern.test(line))) {
            hits.push(`${relativeFile}:${index + 1}`);
          }
        });
    }
  }
  return hits;
}
