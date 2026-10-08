// Merge guard for the app's own entries in PrivacyInfo.xcprivacy (README §6). App Store Connect
// refuses builds whose privacy manifest misses a required-reason API, and the App Privacy answers
// should match what the manifests declare.
import assert from "node:assert/strict";
import { test } from "node:test";

import { expoPrebuildConfig } from "./expo-config.mjs";

test("the iOS privacy manifest says the app tracks no one and collects only the push token", () => {
  const { ios, plugins } = expoPrebuildConfig("production");
  assert.deepEqual(ios.privacyManifests, {
    NSPrivacyTracking: false,
    NSPrivacyCollectedDataTypes: [
      {
        NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeDeviceID",
        NSPrivacyCollectedDataTypeLinked: false,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
      },
    ],
  });
  // The required-reason APIs come from pod install, which merges every pod's declarations into
  // the app's manifest unless expo-build-properties turns that off.
  const buildProperties = plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
  );
  assert.ok(buildProperties, "expo-build-properties is configured");
  assert.notEqual(buildProperties[1].ios?.privacyManifestAggregationEnabled, false);
});
