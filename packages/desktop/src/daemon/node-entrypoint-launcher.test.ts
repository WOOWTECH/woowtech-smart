import { describe, expect, it } from "vitest";
import {
  createNodeEntrypointInvocation,
  type NodeEntrypointSpec,
} from "./node-entrypoint-launcher";

const CLI_ENTRYPOINT: NodeEntrypointSpec = {
  entryPath: "/tmp/paseo-cli.js",
  execArgv: ["--import", "tsx"],
};

describe("node-entrypoint-launcher", () => {
  describe("createNodeEntrypointInvocation", () => {
    it("uses the packaged runner when the desktop app is packaged", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/Applications/Paseo.app/Contents/MacOS/Paseo",
          isPackaged: true,
          packagedRunnerPath:
            "/Applications/Paseo.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: ["ls", "--json"],
          baseEnv: { PATH: "/usr/bin" },
        }),
      ).toEqual({
        command: "/Applications/Paseo.app/Contents/MacOS/Paseo",
        args: [
          "--disable-warning=DEP0040",
          "/Applications/Paseo.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          "node-script",
          "/tmp/paseo-cli.js",
          "ls",
          "--json",
        ],
        env: {
          PATH: "/usr/bin",
          ELECTRON_RUN_AS_NODE: "1",
          PASEO_NODE_ENV: "production",
        },
      });
    });

    // woowtech smart: a packaged test build offers the mock providers (README §31, G26).
    it("runs a packaged test build's node entrypoints in development mode", () => {
      const invocation = createNodeEntrypointInvocation({
        execPath: "C:\\Programs\\woowtech smart\\woowtech smart.exe",
        isPackaged: true,
        testBuild: true,
        packagedRunnerPath: "C:\\runner.js",
        entrypoint: CLI_ENTRYPOINT,
        argvMode: "node-script",
        args: [],
        baseEnv: { PASEO_NODE_ENV: "production" },
      });
      expect(invocation.env.PASEO_NODE_ENV).toBe("development");
      expect(
        createNodeEntrypointInvocation({
          execPath: "C:\\x.exe",
          isPackaged: true,
          testBuild: false,
          packagedRunnerPath: "C:\\runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: [],
          baseEnv: { PASEO_NODE_ENV: "development" },
        }).env.PASEO_NODE_ENV,
      ).toBe("production");
    });

    it("uses the entrypoint directly in development", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/opt/homebrew/bin/electron",
          isPackaged: false,
          packagedRunnerPath: null,
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: ["ls"],
          baseEnv: { PATH: "/usr/bin", PASEO_NODE_ENV: "production" },
        }),
      ).toEqual({
        command: "/opt/homebrew/bin/electron",
        args: ["--import", "tsx", "/tmp/paseo-cli.js", "ls"],
        env: {
          PATH: "/usr/bin",
          ELECTRON_RUN_AS_NODE: "1",
          PASEO_NODE_ENV: "development",
        },
      });
    });

    it("forces packaged launches to production even when NODE_ENV is inherited as development", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/Applications/Paseo.app/Contents/MacOS/Paseo",
          isPackaged: true,
          packagedRunnerPath:
            "/Applications/Paseo.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: [],
          baseEnv: { PATH: "/usr/bin", NODE_ENV: "development" },
        }).env,
      ).toMatchObject({
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "development",
        PASEO_NODE_ENV: "production",
      });
    });

    it("keeps node-style argv for packaged script entrypoints", () => {
      expect(
        createNodeEntrypointInvocation({
          execPath: "/Applications/Paseo.app/Contents/MacOS/Paseo",
          isPackaged: true,
          packagedRunnerPath:
            "/Applications/Paseo.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          entrypoint: CLI_ENTRYPOINT,
          argvMode: "node-script",
          args: ["--dev"],
          baseEnv: { PATH: "/usr/bin" },
        }),
      ).toEqual({
        command: "/Applications/Paseo.app/Contents/MacOS/Paseo",
        args: [
          "--disable-warning=DEP0040",
          "/Applications/Paseo.app/Contents/Resources/app.asar/dist/daemon/node-entrypoint-runner.js",
          "node-script",
          "/tmp/paseo-cli.js",
          "--dev",
        ],
        env: {
          PATH: "/usr/bin",
          ELECTRON_RUN_AS_NODE: "1",
          PASEO_NODE_ENV: "production",
        },
      });
    });
  });
});
