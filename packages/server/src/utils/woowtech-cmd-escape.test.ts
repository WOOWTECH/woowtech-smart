import { describe, expect, it } from "vitest";

import { resolveTerminalSpawnCommand } from "../terminal/terminal.js";
import {
  buildCmdShimCommandLine,
  escapeCmdShimArgument,
  WindowsCommandScriptArgumentError,
} from "./woowtech-cmd-escape.js";

const CORPUS = [
  "plain",
  "",
  "two words",
  "a & b | c",
  "100% done %PATH%",
  "a^b",
  'say "hi"',
  "c:\\path\\",
  "a!b!",
  "fix (wip)",
  "<in> >out",
  "semi;colon,comma",
  "glob*?",
  "back`tick",
  '{"key":"value with spaces","nested":{"quote":"\\"yes\\""}}',
];

describe("escapeCmdShimArgument", () => {
  it("quotes the argument and escapes cmd.exe syntax for both of a shim's parses", () => {
    expect(escapeCmdShimArgument("plain")).toBe('^^^"plain^^^"');
    expect(escapeCmdShimArgument("a & b")).toBe('^^^"a^^^ ^^^&^^^ b^^^"');
    expect(escapeCmdShimArgument("%PATH%")).toBe('^^^"^^^%PATH^^^%^^^"');
    expect(escapeCmdShimArgument('say "hi"')).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
    expect(escapeCmdShimArgument("c:\\path\\")).toBe('^^^"c:\\path\\\\^^^"');
  });

  it("refuses a line break instead of joining the lines (D18)", () => {
    for (const arg of ["a\nb", "a\r\nb", "a\rb"]) {
      expect(() => escapeCmdShimArgument(arg)).toThrow(RangeError);
      expect(() => buildCmdShimCommandLine({ script: "C:\\x\\tool.cmd", args: [arg] })).toThrow(
        WindowsCommandScriptArgumentError,
      );
    }
  });
});

describe("buildCmdShimCommandLine", () => {
  it("runs the script through cmd.exe without AutoRun or delayed expansion", () => {
    expect(
      buildCmdShimCommandLine({ script: "C:\\Program Files\\x\\tool.cmd", args: ["a b"] }),
    ).toBe('/d /v:off /s /c "C:\\Program^ Files\\x\\tool.cmd ^^^"a^^^ b^^^""');
  });

  it("names the script when an argument has a line break", () => {
    expect(() =>
      buildCmdShimCommandLine({ script: "C:\\x\\tool.cmd", args: ["ok", "a\nb"] }),
    ).toThrow(/tool\.cmd/);
  });

  it("matches the in-app terminal's escaping of a .cmd profile", async () => {
    const script = "C:\\Program Files\\x\\tool.cmd";
    const terminal = await resolveTerminalSpawnCommand("tool", CORPUS, {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      resolveExecutable: async () => script,
    });
    expect(terminal.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(buildCmdShimCommandLine({ script, args: CORPUS }).replace("/v:off ", "")).toBe(
      terminal.args,
    );
  });
});
