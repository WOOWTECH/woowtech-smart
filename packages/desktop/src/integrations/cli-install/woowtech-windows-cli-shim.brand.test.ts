import { describe, expect, it, vi } from "vitest";

// Another brand's release tree regenerates brand-values.ts (woowtech/tools/apply-brand.mjs). The
// trampoline takes its names from there, so Apporo smart's trampoline never names woowtech.
vi.mock("@getpaseo/protocol/brand-cli", () => ({ CLI_COMMAND: "apporo-smart" }));
vi.mock("@getpaseo/protocol/brand-name", () => ({ PRODUCT_NAME: "Apporo smart" }));

import { renderWindowsCliTrampoline, WINDOWS_CLI_MARKER } from "./woowtech-windows-cli-shim.js";

describe("renderWindowsCliTrampoline in another brand's release tree", () => {
  it("names that brand and its CLI command", () => {
    const content = renderWindowsCliTrampoline({
      shimPath: "D:\\Tools\\Apporo smart\\resources\\bin\\apporo-smart.cmd",
      env: {},
    });

    expect(WINDOWS_CLI_MARKER).toBe("rem apporo-smart CLI trampoline");
    expect(content.split("\r\n")).toContain(
      "rem apporo-smart CLI trampoline: written by Apporo smart, removed by its uninstaller",
    );
    expect(content).toContain(
      '  echo Apporo smart CLI not found at "%BUNDLED_CLI%". Is Apporo smart installed? 1>&2',
    );
    expect(content).not.toMatch(/woowtech/i);
  });
});
