import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemonLaunchEnvironment } from "@getpaseo/server/daemon-control";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { createDaemonCommandHandlers } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  startDaemonInstance: vi.fn(),
  chooseListen: vi.fn(),
  paseoHome: "",
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  spawnProcess: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mocks.paseoHome),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@getpaseo/server/daemon-control", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolvePaseoHome: vi.fn(() => mocks.paseoHome),
  spawnProcess: mocks.spawnProcess,
  startDaemonInstance: mocks.startDaemonInstance,
}));

// woowtech smart: what the Windows check of the default port decides (README §31, G12).
vi.mock("./woowtech-listen-fallback.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  chooseDesktopDaemonListen: (input: unknown) => mocks.chooseListen(input),
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: path.join(mocks.paseoHome, "daemon.js"),
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

describe("daemon-manager commands", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "paseo daemon manager "));
    mocks.paseoHome = path.join(fixtureRoot, "home");
    mocks.appLogPath = path.join(fixtureRoot, "main.log");
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.startDaemonInstance.mockReset();
    mocks.chooseListen.mockReset();
    mocks.chooseListen.mockResolvedValue({ kind: "keep", reason: "not-windows" });
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers();

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("exposes updater diagnostics through the desktop command boundary", () => {
    const diagnostics = createDaemonCommandHandlers().desktop_update_diagnostics();

    expect(diagnostics).toMatchObject({
      platform: process.platform,
      currentVersion: "1.2.3",
    });
  });

  // woowtech smart: upstream #5636 (Windows G13), the idle app launched the CLI every poll.
  it("reports a stopped daemon without launching the CLI when no local daemon runs", async () => {
    mkdirSync(mocks.paseoHome);
    writeFileSync(path.join(mocks.paseoHome, "server-id"), "srv_existing\n");
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      home: mocks.paseoHome,
      pid: null,
      startedAt: null,
      listen: null,
      hostname: null,
      localDaemon: "stopped",
      desktopManaged: false,
      connectedDaemon: "not_probed",
    });

    const status = await createDaemonCommandHandlers().desktop_daemon_status();

    expect(status).toMatchObject({ serverId: "", status: "stopped", pid: null });
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
  });

  // woowtech smart (G12): the app picks another address when Windows reserved 6770 or a program holds it.
  // The daemon only sees that choice if it is still in the environment it is spawned with: a managed launch
  // deletes every daemon setting variable (PASEO_LISTEN included) and the daemon then reads config.json, which
  // says 6770. Found on 2026-11-05 on Windows 11 with another program holding 6770: the log said "using a
  // fallback 127.0.0.1:16770" and the daemon died with "listen EADDRINUSE 127.0.0.1:6770".
  describe("starting the daemon when the default port is not free", () => {
    function spawnedWith(): NodeJS.ProcessEnv {
      const input = mocks.startDaemonInstance.mock.calls[0]?.[0];
      expect(input).toBeDefined();
      // What startDaemonInstance really passes to spawn().
      return daemonLaunchEnvironment(input);
    }

    beforeEach(() => {
      mkdirSync(mocks.paseoHome);
      mocks.createNodeEntrypointInvocation.mockReturnValue({
        command: "node",
        args: [],
        env: { PASEO_RELAY_ENABLED: "true", PASEO_PASSWORD: "from-the-shell", PATH: "kept" },
      });
      mocks.startDaemonInstance.mockResolvedValue({ instance: { pid: 1 }, spawned: true });
    });

    it("spawns the daemon with the fallback address the check chose", async () => {
      mocks.chooseListen.mockResolvedValue({
        kind: "fallback",
        listen: "127.0.0.1:16770",
        code: "EADDRINUSE",
      });

      await createDaemonCommandHandlers().start_desktop_daemon();

      expect(spawnedWith().PASEO_LISTEN).toBe("127.0.0.1:16770");
    });

    it("still drops the settings the app inherited from the user's shell", async () => {
      mocks.chooseListen.mockResolvedValue({
        kind: "fallback",
        listen: "127.0.0.1:16770",
        code: "EADDRINUSE",
      });

      await createDaemonCommandHandlers().start_desktop_daemon();

      const env = spawnedWith();
      expect(env.PASEO_RELAY_ENABLED).toBeUndefined();
      expect(env.PASEO_PASSWORD).toBeUndefined();
      expect(env.PATH).toBe("kept");
      expect(env.PASEO_HOME).toBe(mocks.paseoHome);
      expect(env.PASEO_DESKTOP_MANAGED).toBe("1");
    });

    it("leaves the address to config.json when the default port is free", async () => {
      await createDaemonCommandHandlers().start_desktop_daemon();

      const env = spawnedWith();
      expect(env.PASEO_LISTEN).toBeUndefined();
      expect(env.PASEO_RELAY_ENABLED).toBeUndefined();
    });
  });

  it("reports an errored daemon when the local daemon state cannot be read", async () => {
    mkdirSync(mocks.paseoHome);
    writeFileSync(path.join(mocks.paseoHome, "paseo.pid"), "garbage");

    const status = await createDaemonCommandHandlers().desktop_daemon_status();

    expect(status).toMatchObject({ serverId: "", status: "errored", pid: null });
    expect(status.error).toBeTruthy();
  });
});
