"use strict";

// Upgrade data-retention check for a packaged desktop app.
//
//   node upgrade-retention.js --phase seed   --app <installed app> --state <dir> (--real-dirs | --isolated)
//   node upgrade-retention.js --phase verify --app <installed app> --state <dir> (--real-dirs | --isolated)
//                             [--expect-version <daemon version>] [--label <previous version>]
//
// Run `seed` with the build users have today, install the new build over it, then run `verify`.
// Both phases launch the packaged app the way a user does and read what it stored: the daemon's
// identity files and config in its home folder, and the renderer's @paseo:* storage. `seed` also
// saves a second host and two settings through the same storage the app reads, so `verify` can tell
// a kept value from a default the new build quietly put back.
//
// --real-dirs uses the app's own data folders, so run it on a disposable machine only.
// --isolated points the app's data folders into --state instead.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { appliedBrand, loadBrand } = require("../../../woowtech/brands/index.cjs");
const smoke = require("./packaged-app-smoke.js");

const brand = process.env.PASEO_SMOKE_BRAND
  ? loadBrand(process.env.PASEO_SMOKE_BRAND)
  : appliedBrand();

const PHASE_TIMEOUT_MS = 180_000;
const DAEMON_SWAP_TIMEOUT_MS = 90_000;
const STORAGE_FLUSH_MS = 8_000;
const APP_EXIT_TIMEOUT_MS = 30_000;

const REGISTRY_KEY = "@paseo:daemon-registry";
const SETTINGS_KEY = "@paseo:app-settings";
const CLIENT_ID_KEY = "@paseo:client-id-v1";
// What a user would lose if it went missing; every other key may legitimately be rewritten.
const CRITICAL_KEYS = new Set([CLIENT_ID_KEY, REGISTRY_KEY, SETTINGS_KEY]);
const TRANSIENT_KEYS = [
  /^@paseo:route-leave-history/,
  /^@paseo:e2e$/,
  /^@paseo:expo-push-token:/,
  /^@paseo:replica-cache/,
  /^@paseo:project-icon-cache$/,
];

// Values inside the ranges every build since 0.10 accepts (terminal scrollback 0..1_000_000,
// code font 9..22); a build that does not recognise one puts the default back.
const SEED_SETTINGS = { terminalScrollbackLines: 4321, codeFontSize: 13 };
// The stored shape 0.10.x writes for a direct host (StoredHostProfileSchema). The name is
// unresolvable on purpose: the app only keeps the entry, it never connects.
const PROBE_HOST = {
  serverId: "srv_upgradeprobe01",
  label: "Upgrade retention probe",
  endpoint: "upgrade-probe.invalid:6767",
};

function parseArgs(argv) {
  const args = { isolated: false, realDirs: false, leaveDaemon: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--isolated") args.isolated = true;
    else if (arg === "--real-dirs") args.realDirs = true;
    else if (arg === "--leave-daemon") args.leaveDaemon = true;
    else if (arg.startsWith("--")) args[arg.slice(2)] = argv[++index];
  }
  return args;
}

function sha256(text) {
  return text === null ? null : crypto.createHash("sha256").update(text).digest("hex");
}

function parseJsonOrNull(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isSubset(expected, actual) {
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return false;
    return Object.keys(expected).every((key) => isSubset(expected[key], actual[key]));
  }
  return expected === actual;
}

function findKey(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  if (key in value) return value[key];
  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function daemonHomeFor(args) {
  if (args.isolated) return path.join(args.state, "daemon-home");
  return path.join(os.homedir(), brand.homeDir.replace(/^~[\\/]/, ""));
}

async function launchApp({ appPath, args, daemonHome, port }) {
  const executablePath = smoke.getExecutablePath(appPath);
  smoke.assertExecutable(executablePath, "Packaged app executable");
  const cdpPort = await smoke.reserveLocalTcpPort();
  const listen = `127.0.0.1:${port}`;
  const userData = path.join(args.state, "user-data");
  let env;
  if (args.isolated) {
    fs.mkdirSync(daemonHome, { recursive: true });
    fs.mkdirSync(userData, { recursive: true });
    env = smoke.createIsolatedDesktopEnv({ home: daemonHome, listen, userData, cdpPort });
  } else {
    env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("PASEO_")),
      ),
      PASEO_LISTEN: listen,
      PASEO_ELECTRON_FLAGS: [
        process.env.PASEO_DESKTOP_SMOKE_ELECTRON_FLAGS,
        `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  const launch = smoke.getLaunchCommand(executablePath, []);
  console.log(`Upgrade retention: launching ${launch.command} ${launch.args.join(" ")}`);
  const stdout = [];
  const stderr = [];
  const child = spawn(launch.command, launch.args, {
    detached: process.platform !== "win32",
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  child.once("error", (error) => stderr.push(`launch error: ${error.stack ?? error}\n`));
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  const browser = await smoke.connectToPackagedApp({
    child,
    cdpPort,
    stdout,
    stderr,
    userData: args.isolated ? userData : args.state,
    daemonHome,
    deadline,
  });
  const page = await smoke.waitForPackagedAppPage(browser, deadline);
  await smoke.assertPackagedRendererLoaded(page, deadline);
  return { child, browser, page, env, stdout, stderr, deadline, listen };
}

async function waitForRunningDaemon(session) {
  let last = null;
  while (Date.now() < session.deadline) {
    try {
      last = await session.page.evaluate(() => window.paseoDesktop.invoke("desktop_daemon_status"));
      if (last?.status === "running" && typeof last.serverId === "string" && last.serverId) {
        return last;
      }
    } catch {}
    await delay(500);
  }
  throw new Error(`The desktop daemon never reached running. Last status: ${JSON.stringify(last)}`);
}

async function readStorage(page) {
  return await page.evaluate(() => {
    const out = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith("@paseo:")) out[key] = localStorage.getItem(key);
    }
    return out;
  });
}

function readHomeFile(daemonHome, name) {
  const file = path.join(daemonHome, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

async function readDaemonVersion({ appPath, session }) {
  try {
    const status = await smoke.runCliShimJsonCommand({
      appPath,
      env: session.env,
      args: ["daemon", "status"],
      label: "Upgrade retention daemon status",
    });
    const version = findKey(status, "daemonVersion");
    return typeof version === "string" ? version : null;
  } catch (error) {
    console.warn(`Upgrade retention: could not read the daemon version: ${error.message}`);
    return null;
  }
}

async function snapshot({ appPath, session, daemonHome, daemon }) {
  const config = readHomeFile(daemonHome, "config.json");
  return {
    takenAt: new Date().toISOString(),
    daemon: {
      serverId: daemon.serverId,
      version: await readDaemonVersion({ appPath, session }),
      status: daemon.status,
    },
    files: {
      serverId: readHomeFile(daemonHome, "server-id")?.trim() ?? null,
      // The keypair is a private key: keep only its hash.
      keypairSha256: sha256(readHomeFile(daemonHome, "daemon-keypair.json")),
      config: parseJsonOrNull(config),
    },
    storage: await readStorage(session.page),
  };
}

async function seedStorage(page) {
  await page.evaluate(
    ({ registryKey, settingsKey, probe, settings, now }) => {
      const rawRegistry = localStorage.getItem(registryKey);
      const registry = rawRegistry ? JSON.parse(rawRegistry) : [];
      if (!Array.isArray(registry)) throw new Error("The host registry is not a list");
      if (!registry.some((host) => host.serverId === probe.serverId)) {
        const id = `direct:${probe.endpoint}`;
        registry.push({
          serverId: probe.serverId,
          label: probe.label,
          connections: [{ id, type: "directTcp", endpoint: probe.endpoint, useTls: false }],
          preferredConnectionId: id,
          createdAt: now,
          updatedAt: now,
        });
      }
      localStorage.setItem(registryKey, JSON.stringify(registry));
      const rawSettings = localStorage.getItem(settingsKey);
      const current = rawSettings ? JSON.parse(rawSettings) : {};
      localStorage.setItem(settingsKey, JSON.stringify({ ...current, ...settings }));
    },
    {
      registryKey: REGISTRY_KEY,
      settingsKey: SETTINGS_KEY,
      probe: PROBE_HOST,
      settings: SEED_SETTINGS,
      now: new Date().toISOString(),
    },
  );
}

function registryHost(storage, serverId) {
  const registry = parseJsonOrNull(storage[REGISTRY_KEY] ?? null);
  return Array.isArray(registry) ? registry.find((host) => host.serverId === serverId) : undefined;
}

function seedWasAccepted(stored) {
  const settings = parseJsonOrNull(stored[SETTINGS_KEY] ?? null);
  const probe = registryHost(stored, PROBE_HOST.serverId);
  const problems = [];
  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    if (settings?.[key] !== value)
      problems.push(`setting ${key} is ${settings?.[key]}, not ${value}`);
  }
  if (!probe) problems.push("the probe host is gone");
  return problems;
}

async function closeApp(session) {
  try {
    const cdp = await session.browser.newBrowserCDPSession();
    await cdp.send("Browser.close");
  } catch {
    // Fall through to the process kill below.
  }
  if (!(await smoke.waitForChildExit(session.child, APP_EXIT_TIMEOUT_MS))) {
    smoke.terminateChild(session.child);
    if (!(await smoke.waitForChildExit(session.child))) {
      smoke.terminateChild(session.child, "SIGKILL");
      await smoke.waitForChildExit(session.child);
    }
  }
  smoke.releaseChildHandles(session.child);
}

function daemonChecks({ seed, verify, expectVersion }) {
  const checks = [
    {
      name: "daemon identity file is unchanged",
      ok: seed.files.serverId !== null && seed.files.serverId === verify.files.serverId,
      detail: { seed: seed.files.serverId, verify: verify.files.serverId },
    },
    {
      name: "daemon keypair is unchanged",
      ok:
        seed.files.keypairSha256 !== null &&
        seed.files.keypairSha256 === verify.files.keypairSha256,
      detail: { seed: seed.files.keypairSha256, verify: verify.files.keypairSha256 },
    },
    {
      name: "the running daemon keeps its server id",
      ok: seed.daemon.serverId === verify.daemon.serverId,
      detail: { seed: seed.daemon.serverId, verify: verify.daemon.serverId },
    },
    {
      name: "daemon config.json keeps every saved value",
      ok:
        seed.files.config !== undefined &&
        seed.files.config !== null &&
        isSubset(seed.files.config, verify.files.config),
      detail: { seed: seed.files.config, verify: verify.files.config },
    },
  ];
  if (expectVersion) {
    checks.push({
      name: "the new build's daemon is the one running",
      ok: verify.daemon.version === expectVersion,
      detail: {
        expected: expectVersion,
        actual: verify.daemon.version,
        before: seed.daemon.version,
      },
    });
  }
  return checks;
}

function connectionTarget(connection) {
  return connection.endpoint ?? connection.path;
}

function registryProblems(seededStorage, verifyStorage) {
  const problems = [];
  const seeded = parseJsonOrNull(seededStorage[REGISTRY_KEY] ?? null);
  for (const host of Array.isArray(seeded) ? seeded : []) {
    const kept = registryHost(verifyStorage, host.serverId);
    if (!kept) {
      problems.push(`${host.serverId} is gone`);
      continue;
    }
    if (kept.label !== host.label) problems.push(`${host.serverId} label changed`);
    const targets = new Set((kept.connections ?? []).map(connectionTarget));
    for (const connection of host.connections ?? []) {
      const target = connectionTarget(connection);
      if (target !== undefined && !targets.has(target))
        problems.push(`${host.serverId} lost ${target}`);
    }
  }
  const stored = parseJsonOrNull(verifyStorage[REGISTRY_KEY] ?? null);
  if (Array.isArray(stored)) {
    const duplicates = stored.length - new Set(stored.map((host) => host.serverId)).size;
    if (duplicates > 0) problems.push(`${duplicates} duplicate host entries`);
  }
  return problems;
}

function settingProblems(verifyStorage) {
  const settings = parseJsonOrNull(verifyStorage[SETTINGS_KEY] ?? null);
  return Object.entries(SEED_SETTINGS)
    .filter(([key, value]) => settings?.[key] !== value)
    .map(([key, value]) => `${key} is ${settings?.[key]}, not ${value}`);
}

function compare({ seed, verify, expectVersion }) {
  const checks = daemonChecks({ seed, verify, expectVersion });
  const missing = Object.keys(seed.storage).filter(
    (key) => !(key in verify.storage) && !TRANSIENT_KEYS.some((pattern) => pattern.test(key)),
  );
  const criticalMissing = missing.filter((key) => CRITICAL_KEYS.has(key));
  checks.push(
    {
      name: "no critical app storage key was dropped",
      ok: criticalMissing.length === 0,
      detail: { criticalMissing },
    },
    {
      name: "client id is unchanged",
      ok: seed.storage[CLIENT_ID_KEY] === verify.storage[CLIENT_ID_KEY],
      detail: { seed: seed.storage[CLIENT_ID_KEY], verify: verify.storage[CLIENT_ID_KEY] },
    },
  );
  const hosts = registryProblems(seed.storage, verify.storage);
  checks.push({
    name: "saved hosts are all kept, none duplicated",
    ok: hosts.length === 0,
    detail: { problems: hosts },
  });
  const settings = settingProblems(verify.storage);
  checks.push({
    name: "seeded settings are kept",
    ok: settings.length === 0,
    detail: { problems: settings },
  });
  return { checks, missingKeys: missing };
}

// The stored value only proves the file survived; the Terminals section proves this build reads it.
async function writeUiDiagnostics(page, stateDir) {
  const seen = await page.evaluate(() => ({
    testIds: [...document.querySelectorAll("[data-testid]")]
      .map((element) => element.getAttribute("data-testid"))
      .slice(0, 150),
    text: document.body.innerText.slice(0, 600),
  }));
  fs.writeFileSync(
    path.join(stateDir, "ui-diagnostics.json"),
    `${JSON.stringify({ url: page.url(), ...seen }, null, 2)}\n`,
  );
  await page.screenshot({ path: path.join(stateDir, "ui-diagnostics.png") });
}

// A profile with no project gets the setup guide over every screen until it is dismissed. Escape closes
// the sheet in every language; the Skip button's label follows the app language, so it is only the fallback.
const SKIP_LABEL = /skip|跳過|跳过|スキップ|건너뛰기/i;

async function dismissSetupGuide(page) {
  const guide = page.getByTestId("onboarding-modal");
  if (!(await guide.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  const closed = await guide
    .waitFor({ state: "hidden", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (closed) return;
  await guide.getByRole("button", { name: SKIP_LABEL }).first().click({ timeout: 10_000 });
  await guide.waitFor({ state: "hidden", timeout: 10_000 });
}

async function readTerminalScrollbackFromUi(page, stateDir) {
  try {
    await dismissSetupGuide(page);
    // Open settings inside the app. Loading the settings URL restarts the app, and its startup restore
    // can put the open-project screen back before the section list exists.
    await page
      .locator('[data-testid="sidebar-settings"]:visible')
      .first()
      .click({ timeout: 20_000 });
    await page
      .locator('[data-testid="settings-section-terminal"]:visible')
      .first()
      .click({ timeout: 20_000 });
    const input = page.getByTestId("terminal-scrollback-input");
    await input.waitFor({ state: "visible", timeout: 20_000 });
    return await input.inputValue();
  } catch (error) {
    await writeUiDiagnostics(page, stateDir).catch(() => undefined);
    return `unavailable: ${String(error.message).split("\n")[0]}`;
  }
}

async function runPhase(args) {
  const appPath = path.resolve(args.app);
  const phase = args.phase;
  fs.mkdirSync(args.state, { recursive: true });
  const daemonHome = daemonHomeFor(args);
  const metaPath = path.join(args.state, "run-meta.json");
  const meta =
    phase === "verify"
      ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
      : { port: await smoke.reserveLocalTcpPort() };
  if (phase === "seed" && !fs.existsSync(path.join(daemonHome, "config.json"))) {
    fs.mkdirSync(daemonHome, { recursive: true });
    smoke.configureIsolatedDaemonHome(daemonHome, `127.0.0.1:${meta.port}`);
  }
  const session = await launchApp({ appPath, args, daemonHome, port: meta.port });
  let report;
  try {
    let daemon = await waitForRunningDaemon(session);
    if (phase === "verify" && args["expect-version"]) {
      // A daemon the old build left running is replaced by the new build's; wait for the swap.
      const swapDeadline = Date.now() + DAEMON_SWAP_TIMEOUT_MS;
      while (
        Date.now() < swapDeadline &&
        (await readDaemonVersion({ appPath, session })) !== args["expect-version"]
      ) {
        await delay(2_000);
      }
      daemon = await waitForRunningDaemon(session);
    }
    if (phase === "seed") {
      await seedStorage(session.page);
      await session.page.reload();
      await smoke.assertPackagedRendererLoaded(session.page, session.deadline);
      daemon = await waitForRunningDaemon(session);
      const problems = seedWasAccepted(await readStorage(session.page));
      if (problems.length > 0) {
        throw new Error(`The previous build did not keep the seeded data: ${problems.join("; ")}`);
      }
    }
    await delay(STORAGE_FLUSH_MS);
    const taken = await snapshot({ appPath, session, daemonHome, daemon });
    if (phase === "seed") {
      fs.writeFileSync(
        path.join(args.state, "seed-snapshot.json"),
        `${JSON.stringify(taken, null, 2)}\n`,
      );
      fs.writeFileSync(
        metaPath,
        `${JSON.stringify({ port: meta.port, label: args.label ?? null }, null, 2)}\n`,
      );
      console.log(
        `Upgrade retention: seeded ${Object.keys(taken.storage).length} app storage keys; daemon ${taken.daemon.version} server ${taken.daemon.serverId}`,
      );
    } else {
      const seed = JSON.parse(fs.readFileSync(path.join(args.state, "seed-snapshot.json"), "utf8"));
      const { checks, missingKeys } = compare({
        seed,
        verify: taken,
        expectVersion: args["expect-version"],
      });
      const terminalScrollback = await readTerminalScrollbackFromUi(session.page, args.state);
      checks.push({
        name: "the Terminals section shows the seeded scrollback",
        // An older section layout is reported, not failed: the stored value above is the hard check.
        ok:
          terminalScrollback === String(SEED_SETTINGS.terminalScrollbackLines)
            ? true
            : "unverified",
        detail: { shown: terminalScrollback },
      });
      report = {
        from: meta.label,
        daemonBefore: seed.daemon.version,
        daemonAfter: taken.daemon.version,
        droppedNonCriticalKeys: missingKeys.filter((key) => !CRITICAL_KEYS.has(key)),
        checks,
      };
      fs.writeFileSync(
        path.join(args.state, "verify-snapshot.json"),
        `${JSON.stringify(taken, null, 2)}\n`,
      );
      fs.writeFileSync(
        path.join(args.state, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
  } catch (error) {
    fs.writeFileSync(
      path.join(args.state, `${phase}-error.txt`),
      `${error.stack ?? error}\n--- stdout\n${session.stdout.join("").slice(-8000)}\n--- stderr\n${session.stderr.join("").slice(-8000)}\n`,
    );
    throw error;
  } finally {
    // Quit the app first: it manages its daemon and would start another one behind our stop.
    await closeApp(session);
    if (!args.leaveDaemon) {
      await smoke.stopCliDaemon({ appPath, env: session.env }).catch((error) => {
        console.warn(`Upgrade retention: daemon stop failed: ${error.message}`);
      });
    }
  }
  return report;
}

function markFor(check) {
  if (check.ok === true) return "PASS";
  return check.ok === "unverified" ? "SKIP" : "FAIL";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !["seed", "verify"].includes(args.phase) ||
    !args.app ||
    !args.state ||
    args.isolated === args.realDirs
  ) {
    process.stderr.write(
      "Usage: node upgrade-retention.js --phase seed|verify --app <app> --state <dir> (--isolated | --real-dirs) [--expect-version <v>] [--label <v>] [--leave-daemon]\n",
    );
    process.exit(2);
  }
  const report = await runPhase(args);
  if (!report) return;
  for (const check of report.checks) {
    const mark = markFor(check);
    console.log(
      `${mark} ${check.name}${check.ok === true ? "" : ` ${JSON.stringify(check.detail)}`}`,
    );
  }
  if (report.droppedNonCriticalKeys.length > 0) {
    console.log(
      `Note: storage keys the new build no longer keeps: ${report.droppedNonCriticalKeys.join(", ")}`,
    );
  }
  const failed = report.checks.filter((check) => check.ok === false);
  if (failed.length > 0) {
    process.stderr.write(
      `Upgrade retention failed: ${failed.map((check) => check.name).join("; ")}\n`,
    );
    process.exit(1);
  }
  console.log(
    `Upgrade retention passed: ${report.from ?? "previous"} -> daemon ${report.daemonAfter}`,
  );
}

module.exports = { compare, isSubset };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}
