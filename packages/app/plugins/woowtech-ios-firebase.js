const fs = require("node:fs");
const path = require("node:path");

// woowtech smart push (fork-owned): an iOS build links React Native Firebase only when it has a
// GoogleService-Info.plist for its variant. app.config.js (through plugins/with-woowtech-push.js)
// and react-native.config.js both decide with this module, so prebuild and autolinking agree.

const PLISTS = {
  production: {
    envKey: "GOOGLE_SERVICE_INFO_PLIST_PROD",
    fallbackRelativePath: "./.secrets/GoogleService-Info.prod.plist",
  },
  development: {
    envKey: "GOOGLE_SERVICE_INFO_PLIST_DEBUG",
    fallbackRelativePath: "./.secrets/GoogleService-Info.debug.plist",
  },
};

function iosGoogleServiceInfoPlist({
  env = process.env,
  appDir = path.resolve(__dirname, ".."),
  warn = console.warn,
} = {}) {
  const plist = PLISTS[env.APP_VARIANT] ?? PLISTS.production;
  const fromEnv = env[plist.envKey];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    // Unlike app.config.js's other secret files, a variable naming a missing file resolves to
    // nothing (with a warning) instead of failing prebuild: autolinking cannot fail, so both
    // sides must read a missing plist the same way.
    const plistPath = fromEnv.trim();
    if (fs.existsSync(path.resolve(appDir, plistPath))) return plistPath;
    warn(`[woowtech push] ${plist.envKey} names a missing file; building without Firebase`);
    return undefined;
  }
  if (fs.existsSync(path.resolve(appDir, plist.fallbackRelativePath))) {
    return plist.fallbackRelativePath;
  }
  return undefined;
}

const RN_FIREBASE_PACKAGES = ["@react-native-firebase/app", "@react-native-firebase/messaging"];

// Autolinking merges each entry over the package's own react-native.config.js one level deep, so
// the package's settings are spread back in: a bare `platforms: { android: null }` would also drop
// @react-native-firebase/app's iOS "[RNFB] Core Configuration" build phase (it applies
// firebase.json). Android never links React Native Firebase: expo-notifications already returns
// the FCM token there, and a second FirebaseMessagingService would take its messages.
function rnFirebaseEntry(packageName, linkOnIos) {
  const packageDir = path.dirname(require.resolve(`${packageName}/package.json`));
  const own = require(path.join(packageDir, "react-native.config.js")).dependency ?? {};
  const platforms = { ...own.platforms, android: null };
  if (!linkOnIos) platforms.ios = null;
  return { ...own, platforms };
}

/** The app's react-native.config.js: React Native Firebase on iOS only, and only with a plist. */
function reactNativeConfig(options) {
  const linkOnIos = iosGoogleServiceInfoPlist(options) !== undefined;
  return {
    dependencies: Object.fromEntries(
      RN_FIREBASE_PACKAGES.map((name) => [name, rnFirebaseEntry(name, linkOnIos)]),
    ),
  };
}

module.exports = { iosGoogleServiceInfoPlist, reactNativeConfig };
