// woowtech smart: tests for woowtech-terminal-name.ts (woowtech/README.md section 25).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { terminalDisplayName } from "./woowtech-terminal-name";

const SERVER_TERMINAL = join(__dirname, "../../../server/src/terminal");

describe("a terminal's name", () => {
  it("reads the daemon's default names in Traditional Chinese", () => {
    const t = i18n.getFixedT("zh-TW");
    expect(terminalDisplayName("Terminal 1", t)).toBe("終端機 1");
    expect(terminalDisplayName("Terminal 12", t)).toBe("終端機 12");
    expect(terminalDisplayName("Terminal", t)).toBe("終端機");
  });

  it("keeps a name someone gave the terminal, or a title its shell set", () => {
    const t = i18n.getFixedT("zh-TW");
    for (const name of ["TERM-PUSH 終端機推播", "Terminal one", "woowtech@mac: ~/push-proj", ""]) {
      expect(terminalDisplayName(name, t)).toBe(name);
    }
  });

  it("stays the daemon's words in English", () => {
    expect(terminalDisplayName("Terminal 3", i18n.getFixedT("en"))).toBe("Terminal 3");
  });

  it("follows the names the daemon gives", () => {
    expect(readFileSync(join(SERVER_TERMINAL, "terminal-manager.ts"), "utf8")).toContain(
      "const defaultName = `Terminal ${terminals.length + 1}`;",
    );
    expect(readFileSync(join(SERVER_TERMINAL, "terminal.ts"), "utf8")).toContain(
      'name = "Terminal",',
    );
  });
});
