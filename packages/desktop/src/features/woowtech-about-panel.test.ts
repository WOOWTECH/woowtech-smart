import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WOOWTECH_COPYRIGHT, woowtechAboutPanelOptions } from "./woowtech-about-panel.js";

function builderConfig(): string {
  return readFileSync(path.resolve(__dirname, "../../electron-builder.yml"), "utf8");
}

describe("the About window", () => {
  it("names WOOW TECH and links the website, keeping the app's own name and version", () => {
    expect(woowtechAboutPanelOptions()).toEqual({
      copyright: "© 2026 WOOW TECH CO., LTD.",
      credits: "https://aiot.woowtech.io/",
      website: "https://aiot.woowtech.io/",
    });
  });

  it("shows the copyright line electron-builder writes into the Mac app's Info.plist", () => {
    const copyright = /^copyright: "(.+)"$/m.exec(builderConfig())?.[1];
    expect(copyright).toBe(WOOWTECH_COPYRIGHT);
  });
});
