import { promises as fs } from "node:fs";
import { app } from "electron";
import log from "electron-log/main";
import { CLI_COMMAND } from "@getpaseo/protocol/brand-cli";
import { commandRunsCli } from "./ownership.js";
import { resolveCliInstallSourcePath } from "./path.js";
import { getBundledCliShimPath, getCliTargetPath, getLocalBinDir } from "./paths.js";
import { ensurePathInShellRc } from "./shell-rc.js";
import { renderWindowsCliTrampoline } from "./woowtech-windows-cli-shim.js";
import { ensureWindowsUserPathEntry } from "./woowtech-windows-user-path.js";

interface InstallStatus {
  installed: boolean;
}

async function pathOrSymlinkExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

function resolveInstallSourcePath(): string {
  return resolveCliInstallSourcePath({
    platform: process.platform,
    isPackaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    shimPath: getBundledCliShimPath(),
    appImagePath: process.env.APPIMAGE,
  });
}

export async function installCli(): Promise<InstallStatus> {
  const targetPath = getCliTargetPath();
  const shimPath = getBundledCliShimPath();

  await fs.mkdir(getLocalBinDir(), { recursive: true });
  if (await pathOrSymlinkExists(targetPath)) {
    await fs.unlink(targetPath);
  }
  if (process.platform === "win32") {
    // Generate a thin .cmd trampoline that delegates to the bundled shim.
    // Only the app install path is baked in — internal details (asar layout,
    // entrypoint scripts) live in the bundled shim and update with the app.
    // woowtech smart: an ASCII trampoline cmd.exe reads under any code page, and the user PATH
    // gets .local\bin like the Mac's shell rc (README §31, plan G16, upstream #4696).
    await fs.writeFile(targetPath, renderWindowsCliTrampoline({ shimPath }));
    const userPath = await ensureWindowsUserPathEntry();
    if (userPath.error) {
      log.warn("[integrations] Could not add .local\\bin to the user PATH", userPath.error);
    } else if (userPath.changed) {
      log.info("[integrations] Added .local\\bin to the user PATH");
    }
  } else {
    await fs.symlink(resolveInstallSourcePath(), targetPath);
  }

  const { shellUpdated } = await ensurePathInShellRc();
  if (shellUpdated) {
    log.info("[integrations] Updated shell rc with ~/.local/bin PATH");
  }

  return getCliInstallStatus();
}

/**
 * Removes the CLI only when the file at the target is the one this app installs, so a command the
 * user put there some other way survives. The shell rc PATH line stays: it is harmless and other
 * tools in ~/.local/bin rely on it.
 */
export async function uninstallCli(): Promise<InstallStatus> {
  const targetPath = getCliTargetPath();
  if (await isOwnInstall(targetPath)) {
    await fs.unlink(targetPath);
  } else if (await pathOrSymlinkExists(targetPath)) {
    log.warn(`[integrations] Left a ${CLI_COMMAND} CLI this app did not install`, { targetPath });
  }
  return getCliInstallStatus();
}

async function isOwnInstall(targetPath: string): Promise<boolean> {
  const shimPath = getBundledCliShimPath();
  try {
    if (process.platform === "win32") {
      return (await fs.readFile(targetPath, "utf-8")) === renderWindowsCliTrampoline({ shimPath });
    }
    return (await fs.readlink(targetPath)) === resolveInstallSourcePath();
  } catch {
    return false;
  }
}

export async function getCliInstallStatus(): Promise<InstallStatus> {
  const installed = await commandRunsCli({
    commandPath: getCliTargetPath(),
    cliPath: resolveInstallSourcePath(),
    platform: process.platform,
  });
  return { installed };
}
