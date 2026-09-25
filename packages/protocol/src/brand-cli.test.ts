import { describe, expect, it } from "vitest";
import { CLI_COMMAND, cliCommandFileName } from "./brand-cli.js";

describe("the woowtech smart CLI command", () => {
  it("is woowtech-smart, apart from the official Paseo's paseo", () => {
    expect(CLI_COMMAND).toBe("woowtech-smart");
  });

  it("is a .cmd trampoline on Windows and a plain executable elsewhere", () => {
    expect(cliCommandFileName("darwin")).toBe("woowtech-smart");
    expect(cliCommandFileName("linux")).toBe("woowtech-smart");
    expect(cliCommandFileName("win32")).toBe("woowtech-smart.cmd");
  });
});
