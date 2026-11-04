// woowtech smart: the Mac app's native binaries match the architecture being packed
// (woowtech/README.md, section 29). npm installs esbuild's binary for the machine that runs
// `npm install` (@esbuild/<platform>-<arch>, which esbuild's postinstall also copies over
// esbuild/bin/esbuild). Packing the other architecture on that machine kept the host's binary:
// 0.8.1's x64 app, packed on an Apple silicon Mac, carried arm64 esbuild, and local plugins could
// not compile on Intel Macs (packages/server/src/server/plugins/compiler.ts runs
// app.asar.unpacked/node_modules/@esbuild/<platform>-<arch>/bin/esbuild). Upstream packs each
// architecture on its own runner (.github/workflows/desktop-release.yml) and never meets this.
const fs = require("fs");
const path = require("path");

// Mach-O cputype → Node.js arch (mach/machine.h).
const MACHO_CPU_ARCH = { 0x01000007: "x64", 0x0100000c: "arm64", 7: "ia32", 12: "arm" };
const MH_OBJECT = 1;
const HEADER_BYTES = 4096;

/**
 * The architectures a Mach-O executable, library or bundle is built for, from its first bytes.
 * Null for anything else, object files included.
 */
function machOArchs(header) {
  if (header.length < 16) return null;
  const thin = header.readUInt32LE(0);
  if (thin === 0xfeedfacf || thin === 0xfeedface) {
    if (header.readUInt32LE(12) === MH_OBJECT) return null;
    return [cpuArch(header.readUInt32LE(4))];
  }
  const fat = header.readUInt32BE(0);
  if (fat !== 0xcafebabe && fat !== 0xcafebabf) return null;
  // Java class files also start with 0xcafebabe; there the next word is the class-file version.
  const count = header.readUInt32BE(4);
  if (count === 0 || count > 20) return null;
  const entryBytes = fat === 0xcafebabf ? 32 : 20;
  const archs = [];
  for (let i = 0; i < count && 8 + (i + 1) * entryBytes <= header.length; i++) {
    archs.push(cpuArch(header.readUInt32BE(8 + i * entryBytes)));
  }
  return archs;
}

function cpuArch(cputype) {
  return MACHO_CPU_ARCH[cputype] ?? `cputype 0x${cputype.toString(16)}`;
}

function readHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    return header.subarray(0, fs.readSync(fd, header, 0, HEADER_BYTES, 0));
  } finally {
    fs.closeSync(fd);
  }
}

/** Mach-O files under dir that are not built for arch, as "relative/path (archs)". Symlinks are skipped. */
function machOFilesMissingArch(dir, arch) {
  const missing = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    const archs = machOArchs(readHeader(file));
    if (archs && !archs.includes(arch)) {
      missing.push(`${path.relative(dir, file)} (${archs.join(", ")})`);
    }
  }
  return missing;
}

/**
 * Keeps only @esbuild/<platform>-<arch> in nodeModules and gives esbuild/bin/esbuild that binary.
 * Throws when the target's package is missing, which means npm installed only the packing machine's.
 */
function selectEsbuildForArch(nodeModules, platform, arch) {
  const scope = path.join(nodeModules, "@esbuild");
  if (!fs.existsSync(scope)) return;
  const target = `${platform}-${arch}`;
  const installed = fs.readdirSync(scope);
  if (!installed.includes(target)) {
    throw new Error(
      `The ${target} app has no @esbuild/${target}: npm installed @esbuild/${installed.join(", @esbuild/")} ` +
        `for this machine, and the app would run esbuild built for another architecture. Put ` +
        `@esbuild/${target} next to the server's esbuild before packing (woowtech/README.md, section 29).`,
    );
  }
  for (const entry of installed) {
    if (entry !== target) fs.rmSync(path.join(scope, entry), { recursive: true, force: true });
  }
  // esbuild's postinstall replaces its JavaScript launcher with the host's binary.
  const launcher = path.join(nodeModules, "esbuild", "bin", "esbuild");
  if (fs.existsSync(launcher) && machOArchs(readHeader(launcher))) {
    fs.copyFileSync(path.join(scope, target, "bin", "esbuild"), launcher);
    fs.chmodSync(launcher, 0o755);
  }
}

/** For the packed .app: the target's esbuild, then no Mach-O file without arch. Throws before signing. */
function prepareWoowtechNativeArch(appPath, arch) {
  if (arch === "universal") return;
  const nodeModules = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
  );
  if (fs.existsSync(nodeModules)) selectEsbuildForArch(nodeModules, "darwin", arch);
  const missing = machOFilesMissingArch(appPath, arch);
  if (missing.length > 0) {
    throw new Error(
      `The ${arch} app contains Mach-O files without ${arch}:\n  ${missing.slice(0, 20).join("\n  ")}`,
    );
  }
}

module.exports = {
  machOArchs,
  machOFilesMissingArch,
  prepareWoowtechNativeArch,
  selectEsbuildForArch,
};
