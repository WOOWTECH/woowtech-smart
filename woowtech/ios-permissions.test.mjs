// Merge guard for the iOS permission prompts (README §6). Apple rejects vague or English-only
// purpose strings (App Store guideline 5.1.1), and localized InfoPlist.strings do not expand
// $(PRODUCT_NAME).
import assert from "node:assert/strict";
import { test } from "node:test";

import { expoIntrospectedConfig } from "./expo-config.mjs";

const KEYS = [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSPhotoLibraryUsageDescription",
];

for (const variant of ["production", "development"]) {
  test(`iOS explains each permission in English, Traditional and Simplified Chinese (${variant})`, () => {
    const { ios, locales } = expoIntrospectedConfig(variant);
    for (const key of KEYS) {
      const english = ios.infoPlist[key];
      assert.match(english, /^Allow woowtech smart to .{20,}\.$/, `${key}: ${english}`);
      for (const language of ["zh-Hant", "zh-Hans"]) {
        const text = locales[language].ios[key];
        assert.match(text, /^允[許许]“?「?渥屋智能/, `${language} ${key}: ${text}`);
        assert.doesNotMatch(text, /\$\(|Allow/, `${language} ${key}: ${text}`);
      }
    }
    // Android's strings.xml may only carry app_name (lint ExtraTranslation, README §6).
    for (const language of ["zh-Hant", "zh-Hans"]) {
      assert.deepEqual(Object.keys(locales[language].android), ["app_name"]);
    }
  });
}
