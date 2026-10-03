import { describe, expect, it } from "vitest";
import { terminalAgentHooksSupported } from "./woowtech-hook-platform.js";

describe("terminal agent hook platforms", () => {
  it("installs hooks on macOS and Linux but not on Windows hosts yet", () => {
    expect(terminalAgentHooksSupported("darwin")).toBe(true);
    expect(terminalAgentHooksSupported("linux")).toBe(true);
    expect(terminalAgentHooksSupported("win32")).toBe(false);
  });
});
