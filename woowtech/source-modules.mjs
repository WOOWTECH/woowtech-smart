// Loads shipped TypeScript sources for the fork's behaviour checks. The packages'
// dist folders are built separately and are often older than the checkout, as
// they are right after an upstream merge, so the checks run the sources through
// tsx instead.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { register } from "tsx/cjs/api";
import { tsImport } from "tsx/esm/api";

const repoRoot = new URL("../", import.meta.url);

/** A source file of an ES module package, such as packages/cli or packages/server. */
export function importSource(relativePath) {
  return tsImport(new URL(relativePath, repoRoot).href, import.meta.url);
}

let registered = false;

/**
 * A source file of a CommonJS package, such as packages/app or packages/desktop.
 * `standIns` replace modules that only work inside the Electron app, keyed by
 * the specifier the source imports, such as "electron".
 */
export function requireSource(relativePath, standIns = {}) {
  if (!registered) {
    register();
    registered = true;
  }
  const file = fileURLToPath(new URL(relativePath, repoRoot));
  const require = createRequire(file);
  for (const [specifier, exports] of Object.entries(standIns)) {
    const filename = require.resolve(specifier);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  return require(file);
}
