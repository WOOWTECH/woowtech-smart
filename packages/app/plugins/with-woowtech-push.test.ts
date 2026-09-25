import path from "node:path";
import { describe, expect, it } from "vitest";

const withWoowtechPush = require("./with-woowtech-push");

function expoConfig(ios: Record<string, unknown>) {
  return {
    name: "woowtech smart",
    slug: "voice-mobile",
    ios,
    _internal: { projectRoot: path.resolve(__dirname, "..") },
  };
}

function modsOf(config: { mods?: Record<string, Record<string, unknown>> }) {
  return Object.fromEntries(
    Object.entries(config.mods ?? {}).map(([platform, mods]) => [
      platform,
      Object.keys(mods).sort(),
    ]),
  );
}

describe("withWoowtechPush", () => {
  it("applies React Native Firebase's iOS changes only, when the build has a plist", () => {
    const config = withWoowtechPush(
      expoConfig({ googleServicesFile: "./GoogleService-Info.plist" }),
      {
        disableSPM: true,
      },
    );

    // AppDelegate (FirebaseApp.configure), the plist in the Xcode project, the Podfile SPM switch.
    expect(modsOf(config)).toEqual({ ios: ["dangerous", "podfile", "xcodeproj"] });
  });

  it("changes nothing without a plist, so machines without Firebase files still prebuild", () => {
    const config = withWoowtechPush(expoConfig({}), { disableSPM: true });

    expect(modsOf(config)).toEqual({});
  });
});
