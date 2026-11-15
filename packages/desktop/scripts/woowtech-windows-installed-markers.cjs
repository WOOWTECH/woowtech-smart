// Inspect only the installed runtime resources, never checkout sources or source maps.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const asar = createRequire(path.join(__dirname, "../e2e/observer.cjs"))("@electron/asar");
const SERVER = "woowtechIsPushEligibleAttentionReason";
const RENDERER = "agentNotificationBodies";
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function inspectInstalledMarkers(installDir, evidencePath) {
  const resources = path.join(fs.realpathSync(installDir), "resources");
  const archive = path.join(resources, "app.asar");
  const evidence = {
    resources,
    archiveSha256: null,
    counts: { [SERVER]: 0, [RENDERER]: 0 },
    matches: [],
    scanned: { server: 0, renderer: 0 },
    passed: false,
  };
  function inspect(bytes, marker, file, storage) {
    const count = bytes.toString("utf8").split(marker).length - 1;
    evidence.counts[marker] += count;
    if (count) evidence.matches.push({ marker, file, storage, count, sha256: digest(bytes) });
  }
  try {
    evidence.archiveSha256 = digest(fs.readFileSync(archive));
    for (const entry of asar.listPackage(archive)) {
      const file = entry.replace(/^[/\\]+/, "").replaceAll("\\", "/");
      if (!file.startsWith("node_modules/@getpaseo/server/dist/") || !/\.(?:c?js|mjs)$/.test(file))
        continue;
      const stat = asar.statFile(archive, file);
      if (stat.link) continue;
      // extractFile follows the header's unpacked flag into app.asar.unpacked.
      const bytes = asar.extractFile(archive, file);
      evidence.scanned.server++;
      inspect(
        bytes,
        SERVER,
        stat.unpacked ? path.join(archive + ".unpacked", file) : `${archive}:${file}`,
        stat.unpacked ? "unpacked" : "asar",
      );
    }
    function walk(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) walk(file);
        else if (item.isFile() && /\.(?:c?js|mjs)$/.test(item.name)) {
          evidence.scanned.renderer++;
          inspect(fs.readFileSync(file), RENDERER, file, "file");
        }
      }
    }
    walk(path.join(resources, "app-dist"));
    if (Object.values(evidence.counts).some((count) => count < 1))
      throw new Error("Required installed notification marker missing");
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.message;
  }
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  if (!evidence.passed) throw new Error(`${evidence.error}; evidence: ${evidencePath}`);
  return evidence;
}
module.exports = { inspectInstalledMarkers };
if (require.main === module) {
  if (process.argv.length !== 4)
    throw new Error("Usage: installed-markers <installed-directory> <evidence.json>");
  console.log(JSON.stringify(inspectInstalledMarkers(process.argv[2], process.argv[3])));
}
