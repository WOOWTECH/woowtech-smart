import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
// The app package is CommonJS; tsx exposes its TypeScript fixture through require.
const require = createRequire(import.meta.url);
const { startIsolatedHostDaemon } = require("../../e2e/support/helpers/isolated-host-daemon.ts");
const { appliedBrand } = require("../../../../woowtech/brands/index.cjs");
if (typeof startIsolatedHostDaemon !== "function") throw new Error("Host fixture did not load");
if (process.argv.includes("--check")) {
  console.log("Native test runner and isolated host fixture loaded.");
  process.exit(0);
}

const execute = promisify(execFile);
const FLOW_CHECKS = {
  "settings-native.yaml": [
    "native settings navigation",
    "terminal preference survives restart",
    "direct host connection",
    "devices and plugin gallery",
    "built-in Tasks settings",
    "native Tasks lane selection",
  ],
  "ipad-touch-layout.yaml": [
    "direct host connection",
    "two home tiles share a row",
    "touch-sized sidebar plus",
  ],
};
const evidence = process.env.EVIDENCE;
const appId = process.env.APP_ID;
if (!evidence || !appId) throw new Error("EVIDENCE and APP_ID are required");
const platform = process.argv[2];
if (platform !== "android" && platform !== "ios") throw new Error("Pass android or ios");
// The shared fixture uses this only to configure browser CORS; this native run has no Metro.
process.env.E2E_METRO_PORT = "8081";
const host = await startIsolatedHostDaemon("native-parity-host");
// The iPad flow checks the docked touch layout (#24, #27); the default flow covers settings.
const flow = process.env.MAESTRO_FLOW ?? "settings-native.yaml";
const ipadLayout = flow === "ipad-touch-layout.yaml";
let passed = false;
let measured = null;
try {
  if (process.env.SEED_PROJECT === "1") await seedProject(host.port);
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
    "-e",
    `PLUGIN_SETTINGS_URL=${appliedBrand().scheme}:///settings/hosts/${host.serverId}/plugins/better-paseo/chat-presentation`,
    "-e",
    `TASKS_URL=${appliedBrand().scheme}:///h/${host.serverId}/plugin/better-paseo/surface/tasks`,
    "--format",
    "junit",
    "--output",
    path.join(evidence, "results.xml"),
    "--debug-output",
    path.join(evidence, "debug"),
    "--test-output-dir",
    path.join(evidence, "debug"),
    fileURLToPath(new URL(`./${flow}`, import.meta.url)),
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
  if (ipadLayout) measured = await measureIpadLayout();
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
        flow,
        checks: passed ? FLOW_CHECKS[flow] : [],
        measured,
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

/** Registers a small demo project, so the sidebar shows a project row with its plus. */
async function seedProject(port) {
  const dir = await mkdtemp(path.join(tmpdir(), "woow-home-dashboard-"));
  await mkdir(path.join(dir, "src"));
  await writeFile(path.join(dir, "README.md"), "# woow-home-dashboard\n");
  await writeFile(
    path.join(dir, "src", "units.ts"),
    "export const celsius = (f: number) => ((f - 32) * 5) / 9;\n",
  );
  const cli = fileURLToPath(new URL("../../../cli/bin/paseo", import.meta.url));
  const args = [cli, "project", "create", dir, "--host", `127.0.0.1:${port}`];
  // Right after start the daemon answers 503 until its worker is ready; the app connects later.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await execute(process.execPath, args);
      return;
    } catch (error) {
      if (attempt >= 30 || !String(error.stderr ?? error).includes("503")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** Bounds of the first node whose identifier matches, from Maestro's view hierarchy. */
function findBounds(node, matches) {
  const attributes = node.attributes ?? {};
  const id = attributes["resource-id"] ?? attributes.identifier ?? "";
  const bounds = /\[(-?[\d.]+),(-?[\d.]+)\]\[(-?[\d.]+),(-?[\d.]+)\]/.exec(attributes.bounds ?? "");
  if (bounds && matches(id)) {
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
    return { id, x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
  }
  for (const child of node.children ?? []) {
    const found = findBounds(child, matches);
    if (found) return found;
  }
  return null;
}

/**
 * Measures the iPad layout from the hierarchy rather than trusting a screenshot. Sizes are compared
 * with the 44pt sidebar Settings button, so the check holds whether Maestro reports points or pixels.
 */
async function measureIpadLayout() {
  const args = [...(process.env.DEVICE_ID ? ["--device", process.env.DEVICE_ID] : []), "hierarchy"];
  const { stdout } = await execute("maestro", args, { cwd: evidence, maxBuffer: 64 * 1024 * 1024 });
  await writeFile(path.join(evidence, "ipad-hierarchy.json"), stdout);
  const tree = JSON.parse(stdout.slice(stdout.indexOf("{")));
  const exact = (name) => (id) => id === name;
  const addProject = findBounds(tree, exact("open-project-submit"));
  const importSession = findBounds(tree, exact("open-project-import-session"));
  const settings = findBounds(tree, exact("sidebar-settings"));
  const plus = findBounds(tree, (id) => id.startsWith("sidebar-project-new-worktree-"));
  if (!addProject || !importSession || !settings || !plus) {
    throw new Error(
      `iPad layout elements missing: ${JSON.stringify({ addProject, importSession, settings, plus })}`,
    );
  }
  const touchTarget = settings.width;
  const result = {
    tilesShareRow:
      Math.abs(addProject.y1 - importSession.y1) <= 2 && importSession.x1 >= addProject.x2,
    tileWidthPoints: Math.round((addProject.width / touchTarget) * 44),
    plusWidthPoints: Math.round((plus.width / touchTarget) * 44),
    elements: { addProject, importSession, settings, plus },
  };
  await writeFile(path.join(evidence, "ipad-checks.json"), JSON.stringify(result, null, 2));
  // The plus was a 24pt box before #24; the kebab's 32pt touch frame is the fix.
  if (!result.tilesShareRow)
    throw new Error(`Home tiles do not share a row: ${JSON.stringify(result)}`);
  if (result.plusWidthPoints < 31)
    throw new Error(`Sidebar plus is not touch-sized: ${JSON.stringify(result)}`);
  return result;
}
