// woowtech smart: terminal agent hooks on Windows wait for the v1.1 port (README §25, plan G9).
// Claude would get a POSIX command that PowerShell cannot run, and Codex a hook that fails in
// every Codex session on the PC (upstream #3632), so a Windows host never installs them.
export function terminalAgentHooksSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}
