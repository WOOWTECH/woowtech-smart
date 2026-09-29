import { beforeAll, describe, expect, it } from "vitest";
import { THEME_OPTIONS, THEME_SWATCHES, THEME_TO_UNISTYLES, darkClaudeTheme } from "@/styles/theme";
import { i18n } from "./i18next";

// woowtech smart names no feature after Claude: the theme whose id is "claude" is 陶土
// (Terracotta). woowtech/README.md section 22.
const THEME_LABEL = "settings.appearance.theme.options.claude";
// Claude in the scripts upstream's translations use, including es's "claudio".
const NAMES_CLAUDE = /claud|クロード|클로드|克劳德|克勞德|كلود|клод/i;

describe("the terracotta theme", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("is called 陶土 in Traditional Chinese and Terracotta in English", () => {
    expect(i18n.t(THEME_LABEL, { lng: "zh-TW" })).toBe("陶土");
    expect(i18n.t(THEME_LABEL, { lng: "en" })).toBe("Terracotta");
  });

  it("names no theme after Claude in any language", () => {
    for (const language of Object.keys(i18n.store.data)) {
      const labels = Object.values(
        i18n.getResource(language, "translation", "settings.appearance.theme.options") as Record<
          string,
          string
        >,
      );
      expect({ language, naming: labels.filter((label) => NAMES_CLAUDE.test(label)) }).toEqual({
        language,
        naming: [],
      });
    }
  });

  it("keeps its id, unistyles theme and colors, so a saved choice still applies", () => {
    expect(THEME_OPTIONS.find((option) => option.name === "claude")).toMatchObject({
      unistylesName: "darkClaude",
      theme: darkClaudeTheme,
    });
    expect(THEME_TO_UNISTYLES.claude).toBe("darkClaude");
    expect(THEME_SWATCHES.claude).toBe("#D97757");
    expect(darkClaudeTheme.colors.accent).toBe("#d97757");
  });
});
