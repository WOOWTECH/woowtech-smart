import { describe, expect, it } from "vitest";
import { readWoowtechTestBuild } from "./woowtech-test-build.js";

describe("desktop test build", () => {
  it("turns on only for a packaged app built with the flag", () => {
    const manifest = JSON.stringify({ name: "io.woowtech.smart.desktop", woowtechTestBuild: true });
    expect(readWoowtechTestBuild({ isPackaged: true, readPackageJson: () => manifest })).toBe(true);
    expect(readWoowtechTestBuild({ isPackaged: false, readPackageJson: () => manifest })).toBe(
      false,
    );
  });

  it("stays off for release builds and unreadable manifests", () => {
    for (const manifest of [
      JSON.stringify({ name: "io.woowtech.smart.desktop" }),
      JSON.stringify({ woowtechTestBuild: "true" }),
      "{ broken",
    ]) {
      expect(readWoowtechTestBuild({ isPackaged: true, readPackageJson: () => manifest })).toBe(
        false,
      );
    }
    expect(
      readWoowtechTestBuild({
        isPackaged: true,
        readPackageJson: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toBe(false);
  });
});
