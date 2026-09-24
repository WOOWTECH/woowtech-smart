const fs = require("node:fs");
const path = require("node:path");
const { createRunOncePlugin, withDangerousMod } = require("expo/config-plugins");

const APP_NAME_ENTRY = /<string name="app_name">[^<]*<\/string>/;

function escapeAndroidString(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

/** The Android resource qualifier for a BCP 47 language tag: zh-Hant -> b+zh+Hant. */
function androidResourceQualifier(languageTag) {
  return `b+${languageTag.split("-").join("+")}`;
}

/** strings.xml naming the app, keeping any other strings the file already has. */
function stringsWithAppName(existing, appName) {
  const entry = `<string name="app_name">${escapeAndroidString(appName)}</string>`;
  if (existing && APP_NAME_ENTRY.test(existing)) {
    return existing.replace(APP_NAME_ENTRY, entry);
  }
  if (existing && existing.includes("</resources>")) {
    return existing.replace("</resources>", `  ${entry}\n</resources>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  ${entry}\n</resources>\n`;
}

/** Writes each language's CFBundleDisplayName from Expo's `locales` as its Android app name. */
function writeLocalizedAppNames(resDir, locales) {
  for (const [languageTag, strings] of Object.entries(locales ?? {})) {
    const appName = strings?.CFBundleDisplayName;
    if (typeof appName !== "string") continue;
    const file = path.join(
      resDir,
      `values-${androidResourceQualifier(languageTag)}`,
      "strings.xml",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    fs.writeFileSync(file, stringsWithAppName(existing, appName));
  }
}

// Expo applies `locales` to iOS only (InfoPlist.strings), so without this a
// Chinese Android launcher would show the English app name.
function withLocalizedAppName(config) {
  return withDangerousMod(config, [
    "android",
    (modConfig) => {
      writeLocalizedAppNames(
        path.join(modConfig.modRequest.platformProjectRoot, "app", "src", "main", "res"),
        modConfig.locales,
      );
      return modConfig;
    },
  ]);
}

module.exports = createRunOncePlugin(withLocalizedAppName, "with-localized-app-name");
module.exports.writeLocalizedAppNames = writeLocalizedAppNames;
