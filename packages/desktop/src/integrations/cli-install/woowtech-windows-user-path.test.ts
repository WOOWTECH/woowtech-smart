import { describe, expect, it, vi } from "vitest";

import {
  ENSURE_USER_PATH_SCRIPT,
  ensureWindowsUserPathEntry,
} from "./woowtech-windows-user-path.js";

describe("ensureWindowsUserPathEntry", () => {
  it("runs one hidden Windows PowerShell with the script and reports a change", async () => {
    const execFile = vi.fn(async (_file: string, _args: string[], _options: object) => ({
      stdout: '{"changed":true}\r\n',
      stderr: "",
    }));
    await expect(ensureWindowsUserPathEntry({ execFile, systemRoot: "D:\\Win" })).resolves.toEqual({
      changed: true,
    });
    const [file, args, options] = execFile.mock.calls[0];
    expect(file).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args.slice(0, 4)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    expect(Buffer.from(args[4], "base64").toString("utf16le")).toBe(ENSURE_USER_PATH_SCRIPT);
    expect(options).toMatchObject({ windowsHide: true, timeout: 15_000 });
  });

  it("keeps the PATH value's kind and never rewrites it through setx or .NET", () => {
    expect(ENSURE_USER_PATH_SCRIPT).toContain("DoNotExpandEnvironmentNames");
    expect(ENSURE_USER_PATH_SCRIPT).toContain("$key.SetValue('Path', $next, $kind)");
    expect(ENSURE_USER_PATH_SCRIPT).not.toMatch(/setx|SetEnvironmentVariable\('Path'/i);
    expect([...ENSURE_USER_PATH_SCRIPT].every((char) => char.charCodeAt(0) < 128)).toBe(true);
  });

  it("reports a failure instead of throwing, so Install CLI still succeeds", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("powershell.exe was blocked");
    });
    await expect(ensureWindowsUserPathEntry({ execFile })).resolves.toEqual({
      changed: false,
      error: "powershell.exe was blocked",
    });
  });
});
