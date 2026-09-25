import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { iosGoogleServiceInfoPlist, reactNativeConfig } = require("./woowtech-ios-firebase");
// The resolver `expo-modules-autolinking react-native-config` runs for each package: it merges
// this app's react-native.config.js entry over the package's own config, one level deep.
const {
  resolveReactNativeModule,
} = require("expo-modules-autolinking/build/reactNativeConfig/reactNativeConfig");

const RN_FIREBASE_PACKAGES = ["@react-native-firebase/app", "@react-native-firebase/messaging"];

async function autolinked(projectConfig: unknown, platform: "ios" | "android") {
  const linked: Record<string, unknown> = {};
  for (const name of RN_FIREBASE_PACKAGES) {
    const packagePath = path.dirname(require.resolve(`${name}/package.json`));
    const resolution = {
      name,
      version: require(`${name}/package.json`).version,
      path: packagePath,
      originPath: packagePath,
      duplicates: null,
      depth: 0,
      source: 0,
    };
    const result = await resolveReactNativeModule(resolution, projectConfig, platform, new Set());
    linked[name] = result?.platforms[platform] ?? null;
  }
  return linked;
}

const appDirs: string[] = [];

function tempAppDir(secrets: string[] = []): string {
  const dir = mkdtempSync(path.join(tmpdir(), "woowtech-ios-firebase-"));
  appDirs.push(dir);
  mkdirSync(path.join(dir, ".secrets"));
  for (const name of secrets) writeFileSync(path.join(dir, ".secrets", name), "<plist/>");
  return dir;
}

describe("iosGoogleServiceInfoPlist", () => {
  afterEach(() => {
    for (const dir of appDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("uses the production plist from .secrets when no variant is set", () => {
    const appDir = tempAppDir(["GoogleService-Info.prod.plist", "GoogleService-Info.debug.plist"]);

    expect(iosGoogleServiceInfoPlist({ env: {}, appDir })).toBe(
      "./.secrets/GoogleService-Info.prod.plist",
    );
  });

  it("uses the debug plist from .secrets for the development variant", () => {
    const appDir = tempAppDir(["GoogleService-Info.prod.plist", "GoogleService-Info.debug.plist"]);

    expect(iosGoogleServiceInfoPlist({ env: { APP_VARIANT: "development" }, appDir })).toBe(
      "./.secrets/GoogleService-Info.debug.plist",
    );
  });

  it("prefers the variant's environment variable, as app.config.js does", () => {
    const appDir = tempAppDir(["GoogleService-Info.debug.plist"]);
    const fromEnv = path.join(appDir, "ci-GoogleService-Info.plist");
    writeFileSync(fromEnv, "<plist/>");

    expect(
      iosGoogleServiceInfoPlist({
        env: { APP_VARIANT: "development", GOOGLE_SERVICE_INFO_PLIST_DEBUG: ` ${fromEnv} ` },
        appDir,
      }),
    ).toBe(fromEnv);
  });

  it("resolves nothing, with a warning, when the environment variable names a missing file", () => {
    const appDir = tempAppDir(["GoogleService-Info.prod.plist"]);
    const warnings: string[] = [];

    expect(
      iosGoogleServiceInfoPlist({
        env: { GOOGLE_SERVICE_INFO_PLIST_PROD: path.join(appDir, "missing.plist") },
        appDir,
        warn: (message: string) => warnings.push(message),
      }),
    ).toBeUndefined();
    expect(warnings).toEqual([
      "[woowtech push] GOOGLE_SERVICE_INFO_PLIST_PROD names a missing file; building without Firebase",
    ]);
  });

  it("resolves nothing without a plist for the variant", () => {
    const appDir = tempAppDir(["GoogleService-Info.prod.plist"]);

    expect(
      iosGoogleServiceInfoPlist({ env: { APP_VARIANT: "development" }, appDir }),
    ).toBeUndefined();
  });
});

describe("reactNativeConfig", () => {
  afterEach(() => {
    for (const dir of appDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("links React Native Firebase on iOS only, with its build phase, when the plist resolves", async () => {
    const config = reactNativeConfig({
      env: {},
      appDir: tempAppDir(["GoogleService-Info.prod.plist"]),
    });

    const ios = await autolinked(config, "ios");
    expect(Object.keys(ios)).toEqual(RN_FIREBASE_PACKAGES);
    expect(ios["@react-native-firebase/app"]).toMatchObject({
      podspecPath: expect.stringMatching(/RNFBApp\.podspec$/),
      scriptPhases: [expect.objectContaining({ name: "[RNFB] Core Configuration" })],
    });
    expect(ios["@react-native-firebase/messaging"]).toMatchObject({
      podspecPath: expect.stringMatching(/RNFBMessaging\.podspec$/),
    });
    expect(await autolinked(config, "android")).toEqual({
      "@react-native-firebase/app": null,
      "@react-native-firebase/messaging": null,
    });
  });

  it("links React Native Firebase nowhere when the plist does not resolve", async () => {
    const config = reactNativeConfig({
      env: { GOOGLE_SERVICE_INFO_PLIST_PROD: "/nonexistent/GoogleService-Info.plist" },
      appDir: tempAppDir(["GoogleService-Info.prod.plist"]),
      warn: () => undefined,
    });

    const nowhere = {
      "@react-native-firebase/app": null,
      "@react-native-firebase/messaging": null,
    };
    expect(await autolinked(config, "ios")).toEqual(nowhere);
    expect(await autolinked(config, "android")).toEqual(nowhere);
  });
});
