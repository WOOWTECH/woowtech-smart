import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { cliCommandFileName } from "@getpaseo/protocol/brand-cli";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

export function getCliTargetPath(): string {
  const filename = cliCommandFileName(process.platform);
  return path.join(getLocalBinDir(), filename);
}

export function getBundledCliShimPath(): string {
  const cliShimFilename = cliCommandFileName(process.platform);

  if (process.platform === "darwin") {
    const electronExePath = app.getPath("exe");
    const appBundle = electronExePath.replace(/\/Contents\/MacOS\/.+$/, "");
    return path.join(appBundle, "Contents", "Resources", "bin", cliShimFilename);
  }

  if (process.platform === "win32") {
    const electronExePath = app.getPath("exe");
    return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
  }

  // Linux
  const electronExePath = app.getPath("exe");
  return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
}
