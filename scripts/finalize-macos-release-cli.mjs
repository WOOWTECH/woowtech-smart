import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { finalizeMacRelease, notaryArgs, run } from "./finalize-macos-release.mjs";

const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const { appliedBrand } = require("../../woowtech/brands/index.cjs");
const [source, output, manifestName, arch] = process.argv.slice(2);
if (!arch || process.argv.length !== 6 || process.platform !== "darwin") {
  throw new Error(
    "Usage (macOS): node scripts/finalize-macos-release-cli.mjs <source> <new-output> <channel-mac.yml> <arm64|x64>",
  );
}
const env = process.env;
// Fail before importing a certificate when notary credentials are incomplete.
notaryArgs({ identity: "Developer ID Application: preflight" }, env);
const {
  createKeychain,
  findIdentity,
  removeKeychain,
} = require("app-builder-lib/out/codeSign/macCodeSign.js");
const { TmpDir } = require("builder-util");
const tmpDir = new TmpDir();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-dmg-gate-"));
const original = execFileSync("security", ["list-keychains", "-d", "user"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const match = /^\s*"([^"\n]+)"\s*$/.exec(line);
    if (!match) throw new Error("Cannot parse keychain search list");
    return match[1];
  });
let keychain = env.CSC_KEYCHAIN || undefined;
let ownedKeychain;
const originalTmp = env.APP_BUILDER_TMP_DIR;
try {
  if (!keychain && env.CSC_LINK) {
    // Reuse builder's certificate transport support (base64, path, URL), in a unique scope.
    env.APP_BUILDER_TMP_DIR = work;
    const info = await createKeychain({
      tmpDir,
      cscLink: env.CSC_LINK,
      cscKeyPassword: env.CSC_KEY_PASSWORD || "",
      currentDir: work,
    });
    keychain = ownedKeychain = info.keychainFile;
  }
  const identity = await findIdentity(
    "Developer ID Application",
    env.CSC_NAME || undefined,
    keychain,
  );
  if (!identity)
    throw new Error("No Developer ID Application identity available for DMG finalization");
  const helper = fileURLToPath(
    new URL("../packages/desktop/scripts/woowtech-notarize-dmg.sh", import.meta.url),
  );
  const files = await finalizeMacRelease({
    source,
    output,
    manifestName,
    arch,
    finalizeDmg: async (input, target) =>
      run("bash", [
        helper,
        ...notaryArgs(
          { input, output: target, app: appliedBrand().name, identity: identity.name, keychain },
          env,
        ),
      ]),
  });
  console.log(
    `Finalized ${files.length} artifacts; review ${path.resolve(output, "finalized.json")}`,
  );
} finally {
  try {
    if (ownedKeychain) await removeKeychain(ownedKeychain);
    // createKeychain can fail after creating its file but before returning its path.
    for (const name of fs.readdirSync(work).filter((entry) => entry.endsWith(".keychain"))) {
      await removeKeychain(path.join(work, name));
    }
  } finally {
    if (originalTmp === undefined) delete env.APP_BUILDER_TMP_DIR;
    else env.APP_BUILDER_TMP_DIR = originalTmp;
    run("security", ["list-keychains", "-d", "user", "-s", ...original]);
    await tmpDir.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
}
