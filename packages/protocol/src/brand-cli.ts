// The command that runs woowtech smart's CLI. The official Paseo installs
// `paseo`, so ours has its own name: both fit on one PATH, and neither app's
// "Install CLI" replaces the other's. The CLI, the daemon's messages and the
// desktop app's CLI install read it from here.

/** What people type to run the CLI. */
export const CLI_COMMAND = "woowtech-smart";

/** The file that runs the CLI on `platform`; Windows needs a .cmd trampoline. */
export function cliCommandFileName(platform: string): string {
  return platform === "win32" ? `${CLI_COMMAND}.cmd` : CLI_COMMAND;
}
