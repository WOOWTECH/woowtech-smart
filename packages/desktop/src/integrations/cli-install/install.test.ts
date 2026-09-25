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
  const savedEnv = { HOME: process.env.HOME, SHELL: process.env.SHELL, PATH: process.env.PATH };
  let root: string;
  let home: string;
  let localBin: string;
  let ourCli: string;
  let officialPaseoCli: string;

  async function createMacApp(name: string, cliNames: string[]): Promise<string> {
    const contents = path.join(root, "Applications", `${name}.app`, "Contents");
    await mkdir(path.join(contents, "MacOS"), { recursive: true });
    await writeFile(path.join(contents, "MacOS", name), "");
    await mkdir(path.join(contents, "Resources", "bin"), { recursive: true });
    for (const cliName of cliNames) {
      await writeFile(path.join(contents, "Resources", "bin", cliName), "#!/bin/sh\n");
    }
    return contents;
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "woowtech-cli-install-"));
    home = path.join(root, "home");
    localBin = path.join(home, ".local", "bin");
    await mkdir(home);
    process.env.HOME = home;
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin:/bin";

    const ourApp = await createMacApp("woowtech smart", ["woowtech-smart", "paseo"]);
    electron.exePath = path.join(ourApp, "MacOS", "woowtech smart");
    ourCli = path.join(ourApp, "Resources", "bin", "woowtech-smart");
    officialPaseoCli = path.join(
      await createMacApp("Paseo", ["paseo"]),
      "Resources",
      "bin",
      "paseo",
    );
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

  it("runs the bundled CLI through the app's helper when woowtech-smart is typed", async () => {
    if (process.platform === "win32") return;
    // The bundle carries upstream's bin/paseo shim under our name as well.
    const shim = fileURLToPath(new URL("../../../bin/paseo", import.meta.url));
    await copyFile(shim, ourCli);
    await chmod(ourCli, 0o755);
    const helperDir = path.join(
      path.dirname(path.dirname(path.dirname(ourCli))),
      "Frameworks",
      "woowtech smart Helper.app",
      "Contents",
      "MacOS",
    );
    await mkdir(helperDir, { recursive: true });
    await writeFile(
      path.join(helperDir, "woowtech smart Helper"),
      '#!/bin/sh\nprintf "cli=%s\\nargs=%s\\n" "$PASEO_CLI" "$*"\n',
    );
    await chmod(path.join(helperDir, "woowtech smart Helper"), 0o755);

    await installCli();
    const result = spawnSync(path.join(localBin, "woowtech-smart"), ["--version"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`cli=${ourCli}\n`);
    expect(result.stdout).toContain("@getpaseo/cli/dist/index.js --version");
  });
});
