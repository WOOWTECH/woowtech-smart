const path = require("node:path");

// woowtech smart push (fork-owned): React Native Firebase is linked on iOS only, where it turns
// the APNs token into an FCM token. Android already gets an FCM token from expo-notifications,
// and a second FirebaseMessagingService would take the messages away from it.
//
// Autolinking merges an entry here over the package's own react-native.config.js one level deep,
// so a bare `platforms: { android: null }` would also drop the package's iOS settings (for
// @react-native-firebase/app, the "[RNFB] Core Configuration" build phase that applies
// firebase.json). Keep the package's settings and turn off Android only.
function withoutAndroid(packageName) {
  const packageDir = path.dirname(require.resolve(`${packageName}/package.json`));
  const own = require(path.join(packageDir, "react-native.config.js")).dependency ?? {};
  return { ...own, platforms: { ...own.platforms, android: null } };
}

module.exports = {
  dependencies: {
    "@react-native-firebase/app": withoutAndroid("@react-native-firebase/app"),
    "@react-native-firebase/messaging": withoutAndroid("@react-native-firebase/messaging"),
  },
};
