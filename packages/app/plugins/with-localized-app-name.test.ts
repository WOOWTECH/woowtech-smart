import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { writeLocalizedAppNames } = require("./with-localized-app-name");

const resDirs: string[] = [];

function tempResDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "localized-app-name-"));
  resDirs.push(dir);
  return dir;
}

function readStrings(resDir: string, qualifier: string): string {
  return readFileSync(path.join(resDir, `values-${qualifier}`, "strings.xml"), "utf8");
}

describe("withLocalizedAppName", () => {
  afterEach(() => {
    for (const dir of resDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("names the app on Android for each language Expo localizes", () => {
    const resDir = tempResDir();

    writeLocalizedAppNames(resDir, {
      "zh-Hans": { CFBundleDisplayName: "渥屋智能" },
      "zh-Hant": { CFBundleDisplayName: "渥屋智能" },
    });

    expect(readStrings(resDir, "b+zh+Hans")).toContain('<string name="app_name">渥屋智能</string>');
    expect(readStrings(resDir, "b+zh+Hant")).toContain('<string name="app_name">渥屋智能</string>');
  });

  it("keeps the other strings already translated for that language", () => {
    const resDir = tempResDir();
    mkdirSync(path.join(resDir, "values-b+zh+Hant"), { recursive: true });
    writeFileSync(
      path.join(resDir, "values-b+zh+Hant", "strings.xml"),
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="greeting">你好</string>\n  <string name="app_name">Paseo</string>\n</resources>\n',
    );

    writeLocalizedAppNames(resDir, { "zh-Hant": { CFBundleDisplayName: "渥屋智能" } });

    const strings = readStrings(resDir, "b+zh+Hant");
    expect(strings).toContain('<string name="greeting">你好</string>');
    expect(strings).toContain('<string name="app_name">渥屋智能</string>');
    expect(strings).not.toContain("Paseo");
  });
});
