import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolvePaseoHome } from "./paseo-home.js";
describe("resolvePaseoHome", () => {
  test("defaults to ~/.woowtech-smart, apart from an upstream Paseo install", () => {
    expect(resolvePaseoHome({})).toBe(path.join(homedir(), ".woowtech-smart"));
  });

  test("resolves PASEO_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "paseo-home-parent-"));
    const paseoHome = path.join(parent, "home");
    try {
      expect(resolvePaseoHome({ PASEO_HOME: paseoHome })).toBe(paseoHome);
      expect(existsSync(paseoHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
