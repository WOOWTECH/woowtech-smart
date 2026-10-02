// woowtech smart: a desktop test build (Windows plan G26, README §25) lets the packaged app's
// built-in daemon offer the mock agent providers, so notification tests need no real agent.
// It is packaged with `-c.extraMetadata.woowtechTestBuild=true`; electron-builder writes the
// field into the packaged package.json, so a release build without it cannot turn on, whatever
// the environment says.

export function readWoowtechTestBuild(input: {
  isPackaged: boolean;
  readPackageJson: () => string;
}): boolean {
  if (!input.isPackaged) {
    return false;
  }
  try {
    const manifest = JSON.parse(input.readPackageJson()) as { woowtechTestBuild?: unknown };
    return manifest.woowtechTestBuild === true;
  } catch {
    return false;
  }
}
