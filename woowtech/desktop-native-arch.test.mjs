// Merge guard for the Mac app's native binaries (README 第 29 節). scripts/after-pack.js keeps the
// target's esbuild and stops the build when a Mach-O file lacks the architecture being packed:
// 0.8.1's x64 app, packed on an Apple silicon Mac, carried arm64 esbuild, and local plugins could
// not compile on Intel Macs.
//
//   node --test woowtech/desktop-native-arch.test.mjs
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const desktopDir = new URL("../packages/desktop/", import.meta.url);
// The packed bundle is named after the brand (woowtech/brands, README 第 30 節): an Apporo
// release tree packs "Apporo smart.app", so the fixtures and after-pack read the same name.
const APP = `${createRequire(import.meta.url)("./brands/index.cjs").appliedBrand().name}.app`;
const requireDesktop = createRequire(new URL("package.json", desktopDir));
const { machOArchs, machOFilesMissingArch, prepareWoowtechNativeArch, selectEsbuildForArch } =
  requireDesktop("./scripts/woowtech-native-arch.js");

const CPU = { x64: 0x01000007, arm64: 0x0100000c };
const MH_EXECUTE = 2;
const MH_OBJECT = 1;

/** A 64-bit Mach-O header for one architecture; tag makes two binaries' bytes differ. */
function thin(arch, { filetype = MH_EXECUTE, tag = "" } = {}) {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(CPU[arch], 4);
  header.writeUInt32LE(filetype, 12);
  return Buffer.concat([header, Buffer.from(tag)]);
}

/** A universal header listing archs. */
function fat(...archs) {
  const header = Buffer.alloc(8 + 20 * archs.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(archs.length, 4);
  archs.forEach((arch, i) => header.writeUInt32BE(CPU[arch], 8 + i * 20));
  return header;
}

const UNPACKED = `${APP}/Contents/Resources/app.asar.unpacked/node_modules`;

/** A temporary directory holding files ({ "relative/path": bytes }); removed after the test. */
function tree(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "woowtech-native-arch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  return root;
}

/** The 0.8.1 x64 app: an x64 main binary next to the arm64 esbuild npm installed on the build Mac. */
function crossBuiltX64(t, extra = {}) {
  return tree(t, {
    [`${APP}/Contents/MacOS/${APP.slice(0, -".app".length)}`]: thin("x64"),
    [`${UNPACKED}/@esbuild/darwin-arm64/bin/esbuild`]: thin("arm64", { tag: "esbuild arm64" }),
    [`${UNPACKED}/@esbuild/darwin-arm64/package.json`]: "{}",
    [`${UNPACKED}/esbuild/bin/esbuild`]: thin("arm64", { tag: "esbuild arm64" }),
    ...extra,
  });
}

test("machOArchs reads thin and universal Mach-O files and nothing else", () => {
  assert.deepEqual(machOArchs(thin("x64")), ["x64"]);
  assert.deepEqual(machOArchs(thin("arm64")), ["arm64"]);
  assert.deepEqual(machOArchs(fat("x64", "arm64")), ["x64", "arm64"]);
  // Object files are not loaded at run time.
  assert.equal(machOArchs(thin("arm64", { filetype: MH_OBJECT })), null);
  // A Java class file shares 0xcafebabe; the next word is its class-file version.
  const javaClass = Buffer.alloc(32);
  javaClass.writeUInt32BE(0xcafebabe, 0);
  javaClass.writeUInt32BE(0x00000034, 4);
  assert.equal(machOArchs(javaClass), null);
  assert.equal(machOArchs(Buffer.from("#!/usr/bin/env node\nrequire('../lib/main.js');\n")), null);
  assert.equal(machOArchs(Buffer.alloc(4)), null);
});

test("an x64 app packed with only the arm64 esbuild stops the build (0.8.1)", (t) => {
  const root = crossBuiltX64(t);
  assert.throws(
    () => prepareWoowtechNativeArch(path.join(root, APP), "x64"),
    /no @esbuild\/darwin-x64: npm installed @esbuild\/darwin-arm64/,
  );
});

test("the x64 app keeps only the x64 esbuild and its launcher becomes that binary", (t) => {
  const x64Esbuild = thin("x64", { tag: "esbuild x64" });
  const root = crossBuiltX64(t, {
    [`${UNPACKED}/@esbuild/darwin-x64/bin/esbuild`]: x64Esbuild,
    [`${UNPACKED}/@esbuild/darwin-x64/package.json`]: "{}",
  });
  prepareWoowtechNativeArch(path.join(root, APP), "x64");
  assert.ok(!existsSync(path.join(root, UNPACKED, "@esbuild/darwin-arm64")));
  assert.ok(existsSync(path.join(root, UNPACKED, "@esbuild/darwin-x64/package.json")));
  const launcher = path.join(root, UNPACKED, "esbuild/bin/esbuild");
  assert.deepEqual(readFileSync(launcher), x64Esbuild);
  assert.equal(statSync(launcher).mode & 0o111, 0o111);
});

test("the arm64 app packed on Apple silicon passes unchanged", (t) => {
  const arm64Esbuild = thin("arm64", { tag: "esbuild arm64" });
  const root = tree(t, {
    [`${APP}/Contents/MacOS/${APP.slice(0, -".app".length)}`]: thin("arm64"),
    [`${UNPACKED}/@esbuild/darwin-arm64/bin/esbuild`]: arm64Esbuild,
    [`${UNPACKED}/esbuild/bin/esbuild`]: arm64Esbuild,
  });
  prepareWoowtechNativeArch(path.join(root, APP), "arm64");
  assert.deepEqual(readFileSync(path.join(root, UNPACKED, "esbuild/bin/esbuild")), arm64Esbuild);
});

test("a JavaScript esbuild launcher is left alone", (t) => {
  const launcherSource = "#!/usr/bin/env node\nrequire('../lib/main.js');\n";
  const root = tree(t, {
    "node_modules/@esbuild/darwin-x64/bin/esbuild": thin("x64"),
    "node_modules/esbuild/bin/esbuild": launcherSource,
  });
  selectEsbuildForArch(path.join(root, "node_modules"), "darwin", "x64");
  assert.equal(
    readFileSync(path.join(root, "node_modules/esbuild/bin/esbuild"), "utf8"),
    launcherSource,
  );
});

test("any Mach-O file without the target architecture stops the build", (t) => {
  const root = tree(t, {
    [`${APP}/Contents/MacOS/${APP.slice(0, -".app".length)}`]: thin("arm64"),
    [`${APP}/Contents/Frameworks/Universal.dylib`]: fat("x64", "arm64"),
    [`${APP}/Contents/Resources/helper`]: thin("x64"),
    [`${APP}/Contents/Resources/notes.txt`]: "not a binary",
  });
  const app = path.join(root, APP);
  // A framework's Versions/Current symlink would otherwise be read twice.
  symlinkSync("Universal.dylib", path.join(app, "Contents/Frameworks/Current"));
  assert.deepEqual(machOFilesMissingArch(app, "arm64"), [
    `${path.join("Contents", "Resources", "helper")} (x64)`,
  ]);
  assert.throws(
    () => prepareWoowtechNativeArch(app, "arm64"),
    /Contents\/Resources\/helper \(x64\)/,
  );
  rmSync(path.join(app, "Contents/Resources/helper"));
  prepareWoowtechNativeArch(app, "arm64");
});

test("after-pack checks the Mac app after pruning and before the fuses and signing", () => {
  const afterPack = readFileSync(new URL("scripts/after-pack.js", desktopDir), "utf8");
  const prune = afterPack.indexOf("pruneNativeModules(context.appOutDir, platform, arch);");
  const check = afterPack.indexOf(
    "prepareWoowtechNativeArch(path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`), arch);",
  );
  const fuses = afterPack.indexOf("await flipWoowtechFuses(context);");
  assert.ok(prune > 0 && check > prune && fuses > check);
  // The app bundle name the check walks is the brand's own, so an Apporo build checks
  // "Apporo smart.app" (woowtech/brands/apply.mjs writes electron-builder.yml; README 第 30 節).
  assert.match(afterPack, /const EXECUTABLE_NAME = appliedBrand\(\)\.name;/);
  assert.match(afterPack, /require\("\.\.\/\.\.\/\.\.\/woowtech\/brands\/index\.cjs"\)/);
});

test("the lockfile pins the x64 esbuild package README section 29 installs", () => {
  // The desktop app bundles the server's esbuild; the README's commands read this entry.
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const esbuild = lock.packages["packages/server/node_modules/esbuild"];
  const x64 = lock.packages["packages/server/node_modules/@esbuild/darwin-x64"];
  assert.ok(
    esbuild && x64,
    "the server's esbuild and its darwin-x64 package are in package-lock.json",
  );
  assert.equal(x64.version, esbuild.version);
  assert.match(x64.integrity, /^sha512-/);
  assert.deepEqual(x64.cpu, ["x64"]);
});
