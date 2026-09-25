// woowtech smart push (fork-owned): keeps the Firebase JS SDK out of the iOS bundle.
//
// @react-native-firebase/messaging imports "@react-native-firebase/app/dist/module/internal/
// nativeModule". Metro resolves that subpath through the package's "exports" map straight to
// nativeModule.js, React Native Firebase's web fallback, which imports firebase/app and with it
// @firebase/app, component, logger and util. Package exports skip the nativeModule.ios.js and
// nativeModule.android.js files next to it, which the package's own relative imports get.
const NATIVE_MODULE = "@react-native-firebase/app/dist/module/internal/nativeModule";

function withNativeRnFirebaseModules(resolveRequest) {
  return (context, moduleName, platform) => {
    if (moduleName === NATIVE_MODULE && (platform === "ios" || platform === "android")) {
      return resolveRequest(context, `${NATIVE_MODULE}.${platform}`, platform);
    }
    return resolveRequest(context, moduleName, platform);
  };
}

module.exports = { withNativeRnFirebaseModules };
