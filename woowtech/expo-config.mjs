// The app config Expo builds with, for the fork's guard tests.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../packages/app/", import.meta.url));

function expoConfig(variant, type, env = {}) {
  const output = execFileSync("npx", ["expo", "config", "--json", "--type", type], {
    cwd: appDir,
    env: { ...process.env, APP_VARIANT: variant, EXPO_NO_TELEMETRY: "1", ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(output);
}

/**
 * The resolved config for one app variant, with plugins applied. `env` adds variables, such as
 * the GoogleService-Info.plist a build uses.
 */
export function expoPrebuildConfig(variant, env = {}) {
  return expoConfig(variant, "prebuild", env);
}

/**
 * The config after Expo's introspectable mods ran, so `ios.infoPlist` is the
 * Info.plist prebuild writes, template defaults included.
 */
export function expoIntrospectedConfig(variant) {
  return expoConfig(variant, "introspect");
}
