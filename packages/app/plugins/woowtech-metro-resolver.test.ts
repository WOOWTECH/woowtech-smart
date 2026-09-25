import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { withNativeRnFirebaseModules } = require("./woowtech-metro-resolver");
const { resolve } = require("metro-resolver");

const APP_DIR = path.resolve(__dirname, "..");
const MESSAGING_ENTRY = require.resolve("@react-native-firebase/messaging");
const NATIVE_MODULE = "@react-native-firebase/app/dist/module/internal/nativeModule";

function lookup(filePath: string) {
  try {
    const stat = statSync(filePath);
    return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(filePath) };
  } catch {
    return { exists: false };
  }
}

function packageOf(filePath: string) {
  let dir = path.dirname(filePath);
  while (path.basename(dir) !== "node_modules" && dir !== path.dirname(dir)) {
    const packageJson = path.join(dir, "package.json");
    if (lookup(packageJson).exists) {
      const json = require(packageJson);
      if (json.name) return { rootPath: dir, packageJson: json };
    }
    dir = path.dirname(dir);
  }
  return null;
}

// Metro's resolver context for an import in React Native Firebase messaging, with the settings
// Expo 54 gives this app's Metro: package "exports" on, "react-native" condition on iOS/Android.
function messagingImportContext() {
  return {
    allowHaste: false,
    assetExts: new Set(["png"]),
    customResolverOptions: {},
    dev: false,
    disableHierarchicalLookup: false,
    doesFileExist: (filePath: string) => lookup(filePath).type === "f",
    extraNodeModules: null,
    fileSystemLookup: (filePath: string) => lookup(path.resolve(APP_DIR, filePath)),
    getPackage: (packageJson: string) => require(packageJson),
    getPackageForModule: (modulePath: string) => {
      const found = packageOf(modulePath);
      return found && { ...found, packageRelativePath: path.relative(found.rootPath, modulePath) };
    },
    isESMImport: true,
    mainFields: ["react-native", "browser", "main"],
    nodeModulesPaths: [],
    originModulePath: MESSAGING_ENTRY,
    preferNativePlatform: true,
    redirectModulePath: (modulePath: string) => modulePath,
    resolveAsset: () => null,
    resolveHasteModule: () => null,
    resolveHastePackage: () => null,
    sourceExts: ["ts", "tsx", "js", "jsx", "json"],
    unstable_conditionNames: [],
    unstable_conditionsByPlatform: {
      ios: ["react-native"],
      android: ["react-native"],
      web: ["browser"],
    },
    unstable_enablePackageExports: true,
    unstable_logWarning: () => undefined,
  };
}

function resolvedFile(
  resolveRequest: (context: unknown, moduleName: string, platform: string) => { filePath: string },
  platform: string,
) {
  return path.basename(resolveRequest(messagingImportContext(), NATIVE_MODULE, platform).filePath);
}

describe("withNativeRnFirebaseModules", () => {
  it("shows why it exists: package exports send messaging's import to the web fallback", () => {
    expect(resolvedFile(resolve, "ios")).toBe("nativeModule.js");
  });

  it("resolves messaging's native module import to the iOS or Android file", () => {
    const resolveRequest = withNativeRnFirebaseModules(resolve);

    expect(resolvedFile(resolveRequest, "ios")).toBe("nativeModule.ios.js");
    expect(resolvedFile(resolveRequest, "android")).toBe("nativeModule.android.js");
  });

  it("is what the app's Metro config resolves with", () => {
    const { resolver } = require("../metro.config.cjs");

    expect(resolvedFile(resolver.resolveRequest, "ios")).toBe("nativeModule.ios.js");
    expect(resolvedFile(resolver.resolveRequest, "android")).toBe("nativeModule.android.js");
  });

  it("leaves the web and every other import alone", () => {
    const requests: string[] = [];
    const resolveRequest = withNativeRnFirebaseModules(
      (_context: unknown, moduleName: string, platform: string | null) => {
        requests.push(`${platform}:${moduleName}`);
        return { type: "empty" };
      },
    );

    resolveRequest({}, NATIVE_MODULE, "web");
    resolveRequest({}, "@react-native-firebase/app", "ios");
    resolveRequest({}, "./nativeModule", "ios");

    expect(requests).toEqual([
      `web:${NATIVE_MODULE}`,
      "ios:@react-native-firebase/app",
      "ios:./nativeModule",
    ]);
  });
});
