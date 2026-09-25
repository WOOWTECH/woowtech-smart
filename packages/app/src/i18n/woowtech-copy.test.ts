import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "./i18next";

function strings(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") {
    return [[prefix, value]];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    strings(child, prefix ? `${prefix}.${key}` : key),
  );
}

function woowtechCopy(language: string): Map<string, string> {
  return new Map(strings(i18n.getResourceBundle(language, "translation").woowtech));
}

describe("woowtech smart's own text", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("loads under the woowtech key", () => {
    expect(i18n.t("woowtech.changelog.empty.title", { lng: "en" })).toBe("No release notes yet");
    expect(i18n.t("woowtech.changelog.empty.title", { lng: "zh-TW" })).toBe("還沒有釋出說明");
  });

  it("is translated in every language", () => {
    const english = woowtechCopy("en");
    expect(english.size).toBeGreaterThan(0);
    for (const language of Object.keys(i18n.store.data)) {
      if (language === "en") continue;
      const copy = woowtechCopy(language);
      const untranslated = [...english].flatMap(([key, text]) =>
        copy.get(key) && copy.get(key) !== text ? [] : [key],
      );
      expect({ language, untranslated }).toEqual({ language, untranslated: [] });
    }
  });
});
