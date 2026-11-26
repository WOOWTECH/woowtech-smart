import { execFile } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
// The app package is CommonJS; tsx exposes its TypeScript fixture through require.
const require = createRequire(import.meta.url);
const { startIsolatedHostDaemon } = require("../../e2e/support/helpers/isolated-host-daemon.ts");
if (typeof startIsolatedHostDaemon !== "function") throw new Error("Host fixture did not load");
if (process.argv.includes("--check")) {
  console.log("Native test runner and isolated host fixture loaded.");
  process.exit(0);
}

const execute = promisify(execFile);
const evidence = process.env.EVIDENCE;
const appId = process.env.APP_ID;
if (!evidence || !appId) throw new Error("EVIDENCE and APP_ID are required");
const platform = process.argv[2];
if (platform !== "android" && platform !== "ios") throw new Error("Pass android or ios");
// The shared fixture uses this only to configure browser CORS; this native run has no Metro.
process.env.E2E_METRO_PORT = "8081";
const host = await startIsolatedHostDaemon("native-parity-host");
let passed = false;
try {
  if (platform === "android") {
    await execute("adb", ["reverse", `tcp:${host.port}`, `tcp:${host.port}`]);
  }
  const args = process.env.DEVICE_ID ? ["--device", process.env.DEVICE_ID] : [];
  args.push(
    "test",
    "-e",
    `APP_ID=${appId}`,
    "-e",
    `HOST_PORT=${host.port}`,
    "--format",
    "junit",
    "--output",
    path.join(evidence, "results.xml"),
    "--debug-output",
    path.join(evidence, "debug"),
    "--test-output-dir",
    path.join(evidence, "debug"),
    fileURLToPath(new URL("./settings-native.yaml", import.meta.url)),
  );
  const { stdout, stderr } = await execute("maestro", args, {
    cwd: evidence,
    env: {
      ...process.env,
      JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ""} -Xmx1024m`.trim(),
    },
    timeout: 15 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  await writeFile(path.join(evidence, "maestro.log"), stdout + stderr);
  passed = true;
} catch (error) {
  await writeFile(
    path.join(evidence, "maestro.log"),
    `${error.stdout ?? ""}${error.stderr ?? ""}\n${error}`,
  );
  throw error;
} finally {
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        source: process.env.NATIVE_CANDIDATE_SHA ?? process.env.GITHUB_SHA,
        testSource: process.env.GITHUB_SHA,
        brand: process.env.WOOWTECH_BRAND,
        platform,
        appId,
        passed,
        hostSource: process.env.GITHUB_SHA,
      },
      null,
      2,
    ),
  );
  if (platform === "android") {
    await execute("adb", ["reverse", "--remove", `tcp:${host.port}`]).catch(() => undefined);
  }
  await copyFile(path.join(host.paseoHome, "daemon.log"), path.join(evidence, "daemon.log")).catch(
    () => undefined,
  );
  await host.close();
}
