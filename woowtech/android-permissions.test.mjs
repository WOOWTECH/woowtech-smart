// Merge guard for the Android permissions the store page lists (README §6). Expo's prebuild
// template asks for SYSTEM_ALERT_WINDOW ("display over other apps"), which only React Native's
// debug tools use; app.config.js blocks it, so prebuild marks it tools:node="remove".
import assert from "node:assert/strict";
import { test } from "node:test";

import { expoPrebuildConfig } from "./expo-config.mjs";

test("the Android app does not ask to display over other apps", () => {
  const { android } = expoPrebuildConfig("production");
  assert.ok(
    android.blockedPermissions.includes("android.permission.SYSTEM_ALERT_WINDOW"),
    `blockedPermissions: ${android.blockedPermissions}`,
  );
  assert.ok(!android.permissions.some((permission) => permission.endsWith("SYSTEM_ALERT_WINDOW")));
});
