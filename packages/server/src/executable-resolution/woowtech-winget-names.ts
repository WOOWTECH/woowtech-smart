// woowtech smart: the file names a WinGet package folder may hold for a command (plan G14).
// WinGet keeps some portable CLIs under their build's name and only links the command name:
// OpenAI.Codex holds codex-x86_64-pc-windows-msvc.exe, and the codex link exists only where
// WinGet could create symlinks (winget-cli #4043). Upstream looks for <name>.exe only.
export function wingetCommandFileNames(name: string): string[] {
  return [
    `${name}.exe`,
    `${name}-x86_64-pc-windows-msvc.exe`,
    `${name}-aarch64-pc-windows-msvc.exe`,
  ];
}
