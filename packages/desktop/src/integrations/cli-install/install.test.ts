import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ exePath: "" }));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => electron.exePath },
}));

vi.mock("electron-log/main", () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import { getCliInstallStatus, installCli } from "./install";

// The official Paseo app installs ~/.local/bin/paseo. woowtech smart installs its
// own command beside it and must never take over, remove or claim Paseo's.
describe("installing the woowtech smart CLI beside the official Paseo", () => {
  const savedEnv = {
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    PATH: process.env.PATH,
    APPIMAGE: process.env.APPIMAGE,
  };
  let root: string;
  let home: string;
  let localBin: string;
  let ourCli: string;
  let officialPaseoCli: string;

  /**
   * An app with the given CLI shims, laid out as it is installed on this platform: a
   * macOS bundle, or on Linux the deb/rpm folder /opt/<productName>, where after-pack
   * has renamed Electron to "<executableName>.bin". Returns the path Electron reports
   * as its executable and the folder of the CLI shims.
   */
  async function installApp(
    name: string,
    cliNames: string[],
  ): Promise<{ exePath: string; binDir: string }> {
    const mac = process.platform === "darwin";
    const appDir = mac
      ? path.join(root, "Applications", `${name}.app`, "Contents")
      : path.join(root, "opt", name);
    const exePath = mac ? path.join(appDir, "MacOS", name) : path.join(appDir, `${name}.bin`);
    const binDir = path.join(appDir, mac ? "Resources" : "resources", "bin");
    await mkdir(path.dirname(exePath), { recursive: true });
    await writeFile(exePath, "");
    await mkdir(binDir, { recursive: true });
    for (const cliName of cliNames) {
      await writeFile(path.join(binDir, cliName), "#!/bin/sh\n");
    }
    return { exePath, binDir };
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "woowtech-cli-install-"));
    home = path.join(root, "home");
    localBin = path.join(home, ".local", "bin");
    await mkdir(home);
    process.env.HOME = home;
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin:/bin";
    // Launched from an AppImage, the app links the CLI to the AppImage instead.
    delete process.env.APPIMAGE;

    const ourApp = await installApp("woowtech smart", ["woowtech-smart", "paseo"]);
    electron.exePath = ourApp.exePath;
    ourCli = path.join(ourApp.binDir, "woowtech-smart");
    officialPaseoCli = path.join((await installApp("Paseo", ["paseo"])).binDir, "paseo");
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("installs woowtech-smart and leaves the official Paseo's paseo command alone", async () => {
    await mkdir(localBin, { recursive: true });
    await symlink(officialPaseoCli, path.join(localBin, "paseo"));

    expect(await getCliInstallStatus()).toEqual({ installed: false });
    expect(await installCli()).toEqual({ installed: true });

    expect(await readlink(path.join(localBin, "woowtech-smart"))).toBe(ourCli);
    expect(await readlink(path.join(localBin, "paseo"))).toBe(officialPaseoCli);
    expect((await readdir(localBin)).sort()).toEqual(["paseo", "woowtech-smart"]);
  });

  it("does not create a paseo command", async () => {
    await installCli();

    expect(await readdir(localBin)).toEqual(["woowtech-smart"]);
  });

  it("counts only a link into this app as installed", async () => {
    await mkdir(localBin, { recursive: true });
    await symlink(officialPaseoCli, path.join(localBin, "woowtech-smart"));
    expect(await getCliInstallStatus()).toEqual({ installed: false });

    await rm(path.join(localBin, "woowtech-smart"));
    await symlink(
      path.join(root, "moved.app", "woowtech-smart"),
      path.join(localBin, "woowtech-smart"),
    );
    expect(await getCliInstallStatus()).toEqual({ installed: false });

    await installCli();
    expect(await getCliInstallStatus()).toEqual({ installed: true });
  });

  it("labels the PATH line it adds to the shell profile as woowtech smart's", async () => {
    await installCli();

    expect(await readFile(path.join(home, ".zshrc"), "utf8")).toBe(
      '\n# Added by woowtech smart\nexport PATH="$HOME/.local/bin:$PATH"\n',
    );
  });

  it("runs the bundled CLI through the app when woowtech-smart is typed", async () => {
    if (process.platform === "win32") return;
    // The bundle carries upstream's bin/paseo shim under our name as well.
    const shim = fileURLToPath(new URL("../../../bin/paseo", import.meta.url));
    await copyFile(shim, ourCli);
    await chmod(ourCli, 0o755);
    // macOS enters Electron through the app's helper, Linux through Electron itself.
    const electronForCli =
      process.platform === "darwin"
        ? path.join(
            path.dirname(path.dirname(path.dirname(ourCli))),
            "Frameworks",
            "woowtech smart Helper.app",
            "Contents",
            "MacOS",
            "woowtech smart Helper",
          )
        : electron.exePath;
    await mkdir(path.dirname(electronForCli), { recursive: true });
    await writeFile(electronForCli, '#!/bin/sh\nprintf "cli=%s\\nargs=%s\\n" "$PASEO_CLI" "$*"\n');
    await chmod(electronForCli, 0o755);

    await installCli();
    const result = spawnSync(path.join(localBin, "woowtech-smart"), ["--version"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`cli=${ourCli}\n`);
    expect(result.stdout).toContain("@getpaseo/cli/dist/index.js --version");
  });
});
