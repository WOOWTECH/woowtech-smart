const fs = require("node:fs");
const path = require("node:path");
const { appliedBrand } = require("../../../../woowtech/brands/index.cjs");

// Keep one pre-Chromium entrypoint for AppRun, desktop entries, updates, and tarballs.
exports.installLinuxLauncher = function installLinuxLauncher(appOutDir) {
  // electron-builder.yml names the executable after the brand (woowtech/brands/apply.mjs).
  const launcher = path.join(appOutDir, appliedBrand().name);
  if (!fs.existsSync(`${launcher}.bin`)) {
    fs.renameSync(launcher, `${launcher}.bin`);
  }
  fs.copyFileSync(path.join(__dirname, "launcher.sh"), launcher);
  fs.chmodSync(launcher, 0o755);
};
