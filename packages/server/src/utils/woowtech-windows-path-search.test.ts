import { describe, expect, it } from "vitest";

import { findOnWindowsPath } from "./woowtech-windows-path-search.js";

function files(...paths: string[]): (path: string) => boolean {
  const present = new Set(paths.map((path) => path.toLowerCase()));
  return (path) => present.has(path.toLowerCase());
}

describe("findOnWindowsPath", () => {
  it("searches PATH folders in order, and PATHEXT order within a folder", () => {
    const exists = files("C:\\b\\gh.exe", "C:\\a\\gh.cmd", "C:\\a\\gh.bat");
    expect(findOnWindowsPath({ name: "gh", env: { Path: "C:\\a;C:\\b" }, exists })).toBe(
      "C:\\a\\gh.bat",
    );
    expect(
      findOnWindowsPath({ name: "gh", env: { Path: "C:\\a;C:\\b", PATHEXT: ".CMD;.BAT" }, exists }),
    ).toBe("C:\\a\\gh.cmd");
  });

  it("never looks in the current folder or other relative PATH entries", () => {
    const exists = files(".\\git.exe", "bin\\git.exe", "C:\\Git\\cmd\\git.exe");
    expect(findOnWindowsPath({ name: "git", env: { PATH: ".;bin;;C:\\Git\\cmd" }, exists })).toBe(
      "C:\\Git\\cmd\\git.exe",
    );
    expect(findOnWindowsPath({ name: "git", env: { PATH: ".;bin" }, exists })).toBeNull();
  });

  it("unquotes quoted PATH entries", () => {
    const exists = files("C:\\Program Files\\GitHub CLI\\gh.exe");
    expect(
      findOnWindowsPath({
        name: "gh",
        env: { Path: '"C:\\Program Files\\GitHub CLI";C:\\x' },
        exists,
      }),
    ).toBe("C:\\Program Files\\GitHub CLI\\gh.exe");
  });

  it("keeps a name that already has a runnable extension", () => {
    const exists = files("C:\\a\\tool.cmd", "C:\\a\\tool.cmd.exe", "C:\\a\\node.exe");
    expect(findOnWindowsPath({ name: "tool.cmd", env: { Path: "C:\\a" }, exists })).toBe(
      "C:\\a\\tool.cmd",
    );
    expect(findOnWindowsPath({ name: "NODE.EXE", env: { Path: "C:\\a" }, exists })).toBe(
      "C:\\a\\NODE.EXE",
    );
  });

  it("finds only programs Windows can start: .com, .exe, .bat and .cmd", () => {
    const exists = files("C:\\a\\script.js", "C:\\a\\script.vbs", "C:\\a\\run.ps1");
    const env = { Path: "C:\\a", PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.JS" };
    expect(findOnWindowsPath({ name: "script", env, exists })).toBeNull();
    expect(findOnWindowsPath({ name: "script.js", env, exists })).toBeNull();
    expect(findOnWindowsPath({ name: "run.ps1", env, exists })).toBeNull();
  });

  it("reads Path and PATHEXT whatever their case", () => {
    const exists = files("C:\\a\\gh.cmd", "C:\\a\\gh.exe");
    expect(findOnWindowsPath({ name: "gh", env: { pAtH: "C:\\a", PathExt: ".cmd" }, exists })).toBe(
      "C:\\a\\gh.cmd",
    );
  });

  it("returns null for a missing program, an empty PATH or a path", () => {
    const exists = files("C:\\a\\gh.exe");
    expect(findOnWindowsPath({ name: "git", env: { Path: "C:\\a" }, exists })).toBeNull();
    expect(findOnWindowsPath({ name: "gh", env: {}, exists })).toBeNull();
    expect(findOnWindowsPath({ name: "C:\\a\\gh", env: { Path: "C:\\a" }, exists })).toBeNull();
    expect(findOnWindowsPath({ name: "  ", env: { Path: "C:\\a" }, exists })).toBeNull();
  });
});
