import { promises as fs } from "node:fs";

// The official Paseo app installs its CLI command into the same ~/.local/bin as
// ours. A command counts as installed only when it runs this app's bundled CLI,
// so another app's link, or a link left behind when this app moved, reads as not
// installed and the settings page offers to install it again.

/**
 * Whether the command at `commandPath` runs `cliPath`: a link that resolves to
 * it, or on Windows the trampoline installCli writes, which calls it.
 */
export async function commandRunsCli(input: {
  commandPath: string;
  cliPath: string;
  platform: NodeJS.Platform;
}): Promise<boolean> {
  try {
    if (input.platform === "win32") {
      const trampoline = await fs.readFile(input.commandPath, "utf8");
      return trampoline.includes(`set "BUNDLED_CLI=${input.cliPath}"`);
    }
    const [command, cli] = await Promise.all([
      fs.realpath(input.commandPath),
      fs.realpath(input.cliPath),
    ]);
    return command === cli;
  } catch {
    return false;
  }
}
