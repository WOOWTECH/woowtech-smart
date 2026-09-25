// woowtech smart push (fork-owned): React Native Firebase is linked on iOS only, and only when the
// build has a GoogleService-Info.plist for its variant. plugins/woowtech-ios-firebase.js decides,
// the same way for app.config.js, so prebuild and autolinking agree.
module.exports = require("./plugins/woowtech-ios-firebase").reactNativeConfig();
