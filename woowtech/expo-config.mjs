// The app config Expo builds with, for the fork's guard tests.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("../packages/app/", import.meta.url));

/** The resolved config for one app variant, with plugins applied. */
export function expoPrebuildConfig(variant) {
  const output = execFileSync("npx", ["expo", "config", "--json", "--type", "prebuild"], {
    cwd: appDir,
    env: { ...process.env, APP_VARIANT: variant, EXPO_NO_TELEMETRY: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(output);
}
