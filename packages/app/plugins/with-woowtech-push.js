const path = require("node:path");
const { withPlugins } = require("expo/config-plugins");

// woowtech smart push (fork-owned): iOS gets its FCM token from React Native Firebase, Android keeps
// the FCM token expo-notifications already returns. So only the iOS half of the
// @react-native-firebase/app config plugin is applied here: FirebaseApp.configure() in the
// AppDelegate, GoogleService-Info.plist in the Xcode project, and the Podfile SPM switch.
// The package's own entry point (app.plugin.js) also changes the Android Gradle files, and its
// "exports" map exposes nothing narrower, so the iOS plugins are loaded by file path.
function loadRnFirebaseIosPlugins() {
  const packageDir = path.dirname(require.resolve("@react-native-firebase/app/package.json"));
  return require(path.join(packageDir, "plugin", "build", "ios"));
}

function withWoowtechPush(config, props = {}) {
  // Without a GoogleService-Info.plist the RNFirebase plugin throws during prebuild, and a
  // development machine without Firebase files must still prebuild.
  if (!config.ios?.googleServicesFile) {
    return config;
  }
  const ios = loadRnFirebaseIosPlugins();
  return withPlugins(config, [
    ios.withFirebaseAppDelegate,
    ios.withIosGoogleServicesFile,
    [ios.withIosDisableSPM, { ios: { disableSPM: props.disableSPM === true } }],
  ]);
}

module.exports = withWoowtechPush;
