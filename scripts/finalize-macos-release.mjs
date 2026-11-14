import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { load, dump } from "js-yaml";
import { isMainModule } from "./is-main-module.mjs";

const desktopRequire = createRequire(new URL("../packages/desktop/package.json", import.meta.url));

function basename(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Unsafe artifact name: ${name}`);
  }
  return name;
}

async function digest(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular file: ${file}`);
  const sha512 = createHash("sha512");
  const sha256 = createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    size += chunk.length;
    sha512.update(chunk);
    sha256.update(chunk);
  }
  return { size, sha512: sha512.digest("base64"), sha256: sha256.digest("hex") };
}

export async function rebuildBlockmap(file) {
  // Same pinned implementation as electron-builder; sidecar mode never appends to the signed DMG.
  const { buildBlockMap } = desktopRequire("app-builder-lib/out/targets/blockmap/blockmap.js");
  return buildBlockMap(file, "gzip", `${file}.blockmap`);
}

export function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.error.code})`);
}

export function notaryArgs({ input, output, app, identity, keychain }, env = process.env) {
  for (const key of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
    if (!env[key])
      throw new Error(`Missing ${key}; DMG finalization requires API-key authentication`);
  }
  if (!fs.statSync(env.APPLE_API_KEY).isFile())
    throw new Error("APPLE_API_KEY must name a key file");
  if (!identity?.startsWith("Developer ID Application: "))
    throw new Error("Developer ID Application identity required");
  return [
    "--dmg",
    input,
    "--out",
    output,
    "--app",
    app,
    "--identity",
    identity,
    ...(keychain ? ["--keychain", keychain] : []),
    "--notary-key",
    env.APPLE_API_KEY,
    "--notary-key-id",
    env.APPLE_API_KEY_ID,
    "--notary-issuer",
    env.APPLE_API_ISSUER,
  ];
}

function validateArchitecturePairs(names) {
  const pairs = new Map();
  for (const name of names) {
    const match = /-(arm64|x64)\.(dmg|zip)$/.exec(name);
    if (!match) throw new Error(`Unsupported architecture/artifact: ${name}`);
    const [, arch, ext] = match;
    const extensions = pairs.get(arch) || new Set();
    if (extensions.has(ext)) throw new Error(`Ambiguous ${arch} ${ext} artifacts`);
    extensions.add(ext);
    pairs.set(arch, extensions);
  }
  if ([...pairs.values()].some((extensions) => extensions.size !== 2))
    throw new Error("Each manifest architecture requires exactly one DMG and one ZIP");
}

async function readBuilderManifest(source, manifestName, arch) {
  const manifest = load(fs.readFileSync(path.join(source, manifestName), "utf8"));
  if (
    !manifest?.version ||
    !Array.isArray(manifest.files) ||
    ![2, 4].includes(manifest.files.length)
  )
    throw new Error("Expected a single-arch or dual-arch DMG/ZIP manifest");
  const names = manifest.files.map((entry) => basename(entry.url));
  if (new Set(names).size !== names.length) throw new Error("Duplicate manifest artifact names");
  validateArchitecturePairs(names);
  const selected = manifest.files.filter(
    (entry) => entry.url.endsWith(`-${arch}.dmg`) || entry.url.endsWith(`-${arch}.zip`),
  );
  if (selected.length !== 2)
    throw new Error("Manifest artifacts do not match requested architecture / DMG and ZIP");
  if (!names.includes(manifest.path))
    throw new Error("Manifest legacy path must reference a listed artifact");
  // Check builder outputs before any signing/submission. ZIP bytes must remain unchanged.
  for (const entry of manifest.files) {
    const actual = await digest(path.join(source, entry.url));
    if (entry.sha512 !== actual.sha512 || entry.size !== actual.size)
      throw new Error(`Input manifest mismatch: ${entry.url}`);
  }
  const originalLegacy = manifest.files.find((entry) => entry.url === manifest.path);
  if (manifest.sha512 !== originalLegacy.sha512) throw new Error("Input legacy SHA512 mismatch");
  if (Object.hasOwn(manifest, "size") && manifest.size !== originalLegacy.size)
    throw new Error("Input legacy size mismatch");
  // Validate every source artifact above, including the architecture not selected for this run.
  manifest.files = selected;
  if (!selected.some((entry) => entry.url === manifest.path)) {
    const zip = selected.find((entry) => entry.url.endsWith(".zip"));
    manifest.path = zip.url;
    manifest.sha512 = zip.sha512;
    if (Object.hasOwn(manifest, "size")) manifest.size = zip.size;
  }
  return manifest;
}

export async function finalizeMacRelease({
  source,
  output,
  manifestName,
  arch,
  finalizeDmg,
  blockmap = rebuildBlockmap,
}) {
  basename(manifestName);
  if (!manifestName.endsWith("-mac.yml") || !["arm64", "x64"].includes(arch))
    throw new Error("Expected a Mac channel manifest and arm64/x64 arch");
  source = fs.realpathSync(source);
  output = path.resolve(output);
  if (fs.existsSync(output)) throw new Error("Finalized output must be a new directory");
  const manifest = await readBuilderManifest(source, manifestName, arch);
  fs.mkdirSync(output, { recursive: true });
  const review = [];
  for (const entry of manifest.files) {
    const input = path.join(source, entry.url);
    const target = path.join(output, entry.url);
    if (entry.url.endsWith(".dmg")) await finalizeDmg(input, target);
    else fs.copyFileSync(input, target, fs.constants.COPYFILE_EXCL);
    const final = await digest(target);
    if (entry.url.endsWith(".zip") && final.sha512 !== entry.sha512)
      throw new Error("ZIP changed while copying");
    const mapInfo = await blockmap(target);
    if (mapInfo.sha512 !== final.sha512 || mapInfo.size !== final.size)
      throw new Error(`Blockmap/content mismatch: ${entry.url}`);
    const mapDigest = await digest(`${target}.blockmap`);
    if (!mapDigest.size) throw new Error(`Empty blockmap: ${entry.url}`);
    entry.sha512 = final.sha512;
    entry.size = final.size;
    delete entry.blockMapSize;
    review.push({ name: entry.url, ...final }, { name: `${entry.url}.blockmap`, ...mapDigest });
  }
  const legacy = manifest.files.find((entry) => entry.url === manifest.path);
  manifest.sha512 = legacy.sha512;
  if (Object.hasOwn(manifest, "size")) manifest.size = legacy.size;
  delete manifest.blockMapSize;
  fs.writeFileSync(
    path.join(output, manifestName),
    dump(manifest, { lineWidth: -1, noRefs: true }),
    { flag: "wx" },
  );
  review.push({ name: manifestName, ...(await digest(path.join(output, manifestName))) });
  // The completion marker is written last. Neither raw output nor helper diagnostics are allowlisted.
  fs.writeFileSync(
    path.join(output, "finalized.json"),
    `${JSON.stringify({ version: manifest.version, arch, manifest: manifestName, files: review }, null, 2)}\n`,
    { flag: "wx" },
  );
  try {
    return await verifyFinalized(output);
  } catch (error) {
    fs.rmSync(path.join(output, "finalized.json"));
    throw error;
  }
}

export async function verifyFinalized(output) {
  const receipt = JSON.parse(fs.readFileSync(path.join(output, "finalized.json"), "utf8"));
  const names = receipt.files.map((entry) => basename(entry.name));
  if (new Set(names).size !== 5 || names.length !== 5 || !names.includes(receipt.manifest))
    throw new Error("Invalid finalized allowlist");
  for (const entry of receipt.files) {
    const actual = await digest(path.join(output, entry.name));
    if (["size", "sha512", "sha256"].some((key) => actual[key] !== entry[key]))
      throw new Error(`Finalized artifact changed: ${entry.name}`);
  }
  const manifest = load(fs.readFileSync(path.join(output, receipt.manifest), "utf8"));
  if (manifest.version !== receipt.version || manifest.files.length !== 2)
    throw new Error("Finalized manifest mismatch");
  for (const entry of manifest.files) {
    const actual = receipt.files.find((file) => file.name === entry.url);
    if (
      !actual ||
      entry.sha512 !== actual.sha512 ||
      entry.size !== actual.size ||
      !names.includes(`${entry.url}.blockmap`)
    )
      throw new Error("Finalized manifest/content mismatch");
  }
  const legacy = manifest.files.find((entry) => entry.url === manifest.path);
  if (!legacy || manifest.sha512 !== legacy.sha512)
    throw new Error("Finalized legacy SHA512 mismatch");
  if (Object.hasOwn(manifest, "size") && manifest.size !== legacy.size)
    throw new Error("Finalized legacy size mismatch");
  return names.map((name) => path.resolve(output, name));
}

if (isMainModule(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--verify" && args.length === 1) {
    process.stdout.write(`${(await verifyFinalized(args[0])).join("\n")}\n`);
  } else {
    throw new Error(
      "Usage: node scripts/finalize-macos-release.mjs --verify <finalized-directory>; use finalize-macos-release-cli.mjs to sign",
    );
  }
}
