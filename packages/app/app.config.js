const fs = require("node:fs");
const path = require("node:path");
const pkg = require("./package.json");
const withAndroidAsyncStorageSize = require("./plugins/with-android-async-storage-size");
const withAndroidProfileable = require("./plugins/with-android-profileable");
const withFdroidAutolinking = require("./plugins/with-fdroid-autolinking");
const withPasteInput = require("./plugins/with-paste-input");
const withWoowtechPush = require("./plugins/with-woowtech-push");
const { iosGoogleServiceInfoPlist } = require("./plugins/woowtech-ios-firebase");
const { getNativeReleaseVersion } = require("./native-release-version");
const appVariant = process.env.APP_VARIANT ?? "production";
const isFdroidBuild = process.env.PASEO_FDROID_BUILD === "1";
const isProfileBuild = process.env.PASEO_PROFILE_BUILD === "1";

// Keep CFBundleName independent of Expo's sanitized PRODUCT_NAME. The home-screen
// display name is CFBundleDisplayName; setting this short name does not guarantee
// the icon label's spacing or truncation. Debug and Release labels still need validation.
const shortName = "woowtech smart";
const chineseShortName = "渥屋智能";

// woowtech smart: the purpose strings iOS shows when it asks for each permission, in the phone's
// language. Apple has rejected a woowtech app for vague or English-only permission text (App
// Store guideline 5.1.1). Localized InfoPlist.strings do not expand $(PRODUCT_NAME), so the app
// name is written out.
const iosPermissionText = {
  en: {
    NSCameraUsageDescription: `Allow ${shortName} to use the camera to scan the QR code that pairs it with your computer.`,
    NSMicrophoneUsageDescription: `Allow ${shortName} to use the microphone so you can dictate messages to your agents.`,
    NSPhotoLibraryUsageDescription: `Allow ${shortName} to access your photos so you can attach images to messages to your agents.`,
  },
  "zh-Hant": {
    NSCameraUsageDescription: `允許「${chineseShortName}」使用相機，掃描配對電腦用的 QR Code。`,
    NSMicrophoneUsageDescription: `允許「${chineseShortName}」使用麥克風，用語音輸入給 Agent 的訊息。`,
    NSPhotoLibraryUsageDescription: `允許「${chineseShortName}」取用你的照片，把圖片附加到給 Agent 的訊息。`,
  },
  "zh-Hans": {
    NSCameraUsageDescription: `允许“${chineseShortName}”使用相机，扫描配对电脑用的二维码。`,
    NSMicrophoneUsageDescription: `允许“${chineseShortName}”使用麦克风，用语音输入发给 Agent 的消息。`,
    NSPhotoLibraryUsageDescription: `允许“${chineseShortName}”访问你的照片，把图片附加到发给 Agent 的消息。`,
  },
};

const buildProfile = isFdroidBuild
  ? {
      androidPermissions: [
        "RECORD_AUDIO",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
      cameraPlugins: [],
      fdroidPlugins: [withFdroidAutolinking],
      notificationPlugins: [],
    }
  : {
      androidPermissions: [
        "RECORD_AUDIO",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "CAMERA",
        "android.permission.CAMERA",
      ],
      cameraPlugins: [
        [
          "expo-camera",
          {
            cameraPermission: iosPermissionText.en.NSCameraUsageDescription,
          },
        ],
      ],
      fdroidPlugins: [],
      notificationPlugins: [
        [
          "expo-notifications",
          {
            icon: "./assets/images/notification-icon.png",
            color: "#6183fc",
            // woowtech smart: FCM's default channel in the Android manifest, where a push naming a
            // channel the phone lacks lands instead of FCM's "Miscellaneous" (woowtech/README.md, 16).
            defaultChannel: "agent-finished",
          },
        ],
      ],
    };

function resolveSecretFile(params) {
  const fromEnv = process.env[params.envKey];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const fallbackAbsolutePath = path.resolve(__dirname, params.fallbackRelativePath);
  if (fs.existsSync(fallbackAbsolutePath)) {
    return params.fallbackRelativePath;
  }

  return undefined;
}

const variants = {
  production: {
    name: "woowtech smart",
    chineseName: "渥屋智能",
    packageId: "io.woowtech.smart",
    googleServicesFile: resolveSecretFile({
      envKey: "GOOGLE_SERVICES_FILE_PROD",
      fallbackRelativePath: "./.secrets/google-services.prod.json",
    }),
    googleServiceInfoPlist: resolveSecretFile({
      envKey: "GOOGLE_SERVICE_INFO_PLIST_PROD",
      fallbackRelativePath: "./.secrets/GoogleService-Info.prod.plist",
    }),
  },
  development: {
    name: "woowtech smart Debug",
    chineseName: "渥屋智能 Debug",
    packageId: "io.woowtech.smart.debug",
    googleServicesFile: resolveSecretFile({
      envKey: "GOOGLE_SERVICES_FILE_DEBUG",
      fallbackRelativePath: "./.secrets/google-services.debug.json",
    }),
    googleServiceInfoPlist: resolveSecretFile({
      envKey: "GOOGLE_SERVICE_INFO_PLIST_DEBUG",
      fallbackRelativePath: "./.secrets/GoogleService-Info.debug.plist",
    }),
  },
};

const variant = variants[appVariant] ?? variants.production;
// woowtech push: react-native.config.js links React Native Firebase on the same plist, so both
// read it through iosGoogleServiceInfoPlist() instead of variant.googleServiceInfoPlist.
const googleServiceInfoPlist = iosGoogleServiceInfoPlist();
const nativeReleaseVersion = getNativeReleaseVersion(pkg.version);

// Expo 54 writes every key outside `ios` and `android` into both platforms. On Android an
// Info.plist key becomes a strings.xml entry the default locale lacks, and release lint fails
// with ExtraTranslation, so each platform gets only its own name keys.
function chineseLocale(language) {
  return {
    ios: {
      CFBundleDisplayName: variant.chineseName,
      CFBundleName: chineseShortName,
      ...iosPermissionText[language],
    },
    android: { app_name: variant.chineseName },
  };
}

export default {
  expo: {
    name: variant.name,
    slug: "voice-mobile",
    version: nativeReleaseVersion.appVersion,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "woowtech-smart",
    // Chinese launchers show the Chinese name.
    locales: {
      "zh-Hans": chineseLocale("zh-Hans"),
      "zh-Hant": chineseLocale("zh-Hant"),
    },
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      // woowtech smart: iOS 18 dark and tinted icons draw the bare symbol on the system's own
      // background; the light icon stays the opaque white tile the App Store requires.
      icon: {
        light: "./assets/images/icon.png",
        dark: "./assets/images/ios-icon-dark.png",
        tinted: "./assets/images/ios-icon-tinted.png",
      },
      supportsTablet: true,
      infoPlist: {
        CFBundleName: shortName,
        ...iosPermissionText.en,
        ITSAppUsesNonExemptEncryption: false,
      },
      bundleIdentifier: variant.packageId,
      ...(googleServiceInfoPlist ? { googleServicesFile: googleServiceInfoPlist } : {}),
      buildNumber: nativeReleaseVersion.iosBuildNumber,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#FFFFFF",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        // woowtech smart: Android 13+ "Themed icons" draws this silhouette in the system colors.
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      softwareKeyboardLayoutMode: "resize",
      // Allow HTTP connections for local network hosts (required for release builds)
      usesCleartextTraffic: true,
      permissions: buildProfile.androidPermissions,
      package: variant.packageId,
      versionCode: nativeReleaseVersion.androidVersionCode,
      ...(variant.googleServicesFile ? { googleServicesFile: variant.googleServicesFile } : {}),
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
    },
    plugins: [
      "expo-router",
      withPasteInput,
      [withAndroidAsyncStorageSize, 64],
      ...buildProfile.cameraPlugins,
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      ...buildProfile.notificationPlugins,
      [withWoowtechPush, { disableSPM: true }],
      "expo-audio",
      [
        "expo-gradle-jvmargs",
        {
          xmx: "4096m",
          maxMetaspace: "1024m",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 29,
            kotlinVersion: "2.1.20",
            // Allow HTTP connections for local network hosts in release builds
            usesCleartextTraffic: true,
          },
          ios: {
            // woowtech push: the Firebase SDK comes from CocoaPods (disableSPM above) as static
            // frameworks. Expo 54's precompiled React Native keeps some pods as static libraries,
            // which rules out dynamic frameworks; RNFirebase's pods are listed with them.
            // react-native-paste-input stays a static library so the bridging header's
            // <react-native-paste-input/PasteInputModule.h> import (with-paste-input) still resolves.
            useFrameworks: "static",
            forceStaticLinking: ["RNFBApp", "RNFBMessaging", "react-native-paste-input"],
          },
        },
      ],
      ...buildProfile.fdroidPlugins,
      ...(isProfileBuild ? [withAndroidProfileable] : []),
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
      autolinkingModuleResolution: true,
    },
    extra: {
      fdroidBuild: isFdroidBuild,
      profileBuild: isProfileBuild,
      router: {},
      eas: {
        projectId: "0e7f65ce-0367-46c8-a238-2b65963d235a",
      },
    },
    owner: "getpaseo",
  },
};
