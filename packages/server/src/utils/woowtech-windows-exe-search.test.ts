import { describe, expect, it } from "vitest";
import {
  NO_CWD_EXE_SEARCH,
  blockCurrentFolderExeSearch,
  withCurrentFolderExeSearch,
} from "./woowtech-windows-exe-search.js";

describe("Windows current-folder executable search", () => {
  it("is switched off for the Windows daemon and everything it starts", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows" };
    blockCurrentFolderExeSearch(env, "win32");
    expect(env[NO_CWD_EXE_SEARCH]).toBe("1");
  });

  it("leaves macOS and Linux alone", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const env: NodeJS.ProcessEnv = {};
      blockCurrentFolderExeSearch(env, platform);
      expect(env).toEqual({});
    }
  });

  it("gives the in-app terminal the usual Windows behavior back", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows" };
    blockCurrentFolderExeSearch(env, "win32");
    expect(withCurrentFolderExeSearch(env)).toEqual({ PATH: "C:\\Windows" });
    expect(env[NO_CWD_EXE_SEARCH]).toBe("1");
  });

  it("never removes a value the user set themselves", () => {
    const env: NodeJS.ProcessEnv = { noDefaultCurrentDirectoryInExePath: "1" };
    blockCurrentFolderExeSearch(env, "win32");
    expect(env).toEqual({ noDefaultCurrentDirectoryInExePath: "1" });
    expect(withCurrentFolderExeSearch(env)).toEqual({ noDefaultCurrentDirectoryInExePath: "1" });
  });
});
