// woowtech smart: Windows looks for a bare command name in the current folder first. The daemon
// runs git, Copilot and Pi by name inside the user's project folders, so a project that carries
// git.exe or copilot.cmd would have it run (woowtech/README.md §31, plan G28). libuv (1.48+) and
// cmd.exe both skip the current folder when NoDefaultCurrentDirectoryInExePath is set, and
// agents inherit it. The in-app terminal drops it again, but only when we were the ones who set
// it, so a user's own setting survives.
export const NO_CWD_EXE_SEARCH = "NoDefaultCurrentDirectoryInExePath";
const SET_BY_WOOWTECH = "WOOWTECH_NO_CWD_EXE_SEARCH";

export function blockCurrentFolderExeSearch(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): void {
  if (platform !== "win32" || hasKey(env, NO_CWD_EXE_SEARCH)) {
    return;
  }
  env[NO_CWD_EXE_SEARCH] = "1";
  env[SET_BY_WOOWTECH] = "1";
}

/** For the in-app terminal: undo blockCurrentFolderExeSearch, leave a user's own value alone. */
export function withCurrentFolderExeSearch<T extends Record<string, string | undefined>>(
  env: T,
): T {
  if (env[SET_BY_WOOWTECH] !== "1") {
    return env;
  }
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === NO_CWD_EXE_SEARCH.toLowerCase() || key === SET_BY_WOOWTECH) {
      delete next[key];
    }
  }
  return next;
}

function hasKey(env: NodeJS.ProcessEnv, name: string): boolean {
  return Object.keys(env).some((key) => key.toLowerCase() === name.toLowerCase());
}
