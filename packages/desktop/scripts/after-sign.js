const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");
const { appliedBrand } = require("../../../woowtech/brands/index.cjs");

// electron-builder.yml names the app after the brand (woowtech/brands/apply.mjs).
const EXECUTABLE_NAME = appliedBrand().name;

exports.default = async function afterSign(context) {
  if (process.env.PASEO_DESKTOP_SMOKE !== "1") {
    return;
  }

  if (context.electronPlatformName !== "darwin") {
    return;
  }

  await smokePackagedDesktopApp({
    appPath: path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`),
  });
};
