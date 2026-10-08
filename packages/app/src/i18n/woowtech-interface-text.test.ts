// woowtech smart: the text upstream hardcoded in English, now under woowtech.interfaceText
// (woowtech/README.md section 14), as people see it in Traditional Chinese and in English.
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { buildKeyboardShortcutHelpSections } from "@/keyboard/keyboard-shortcuts";

function pinWorkspaceLabel(): string {
  const rows = buildKeyboardShortcutHelpSections({ isMac: true, isDesktop: true }).flatMap(
    (section) => section.rows,
  );
  const row = rows.find((candidate) => candidate.id === "pin-workspace");
  if (!row) throw new Error("the shortcut help has no pin-workspace row");
  return i18n.t(row.labelKey);
}

describe("upstream's hardcoded English", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("reads in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(
      ["markAsRead", "markAsUnread", "project", "searchProjects", "noMatchingHosts"].map((key) =>
        i18n.t(`woowtech.interfaceText.${key}`),
      ),
    ).toEqual(["標示為已讀", "標示為未讀", "專案", "搜尋專案", "沒有符合的主機"]);
    expect(i18n.t("woowtech.interfaceText.questionPosition", { index: 2, total: 3 })).toBe(
      "第 2 題，共 3 題",
    );
    expect(pinWorkspaceLabel()).toBe("置頂工作區");
  });

  it("stays upstream's text in English", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("woowtech.interfaceText.markAsUnread")).toBe("Mark as unread");
    expect(i18n.t("woowtech.interfaceText.questionPosition", { index: 2, total: 3 })).toBe(
      "Question 2 of 3",
    );
    expect(pinWorkspaceLabel()).toBe("Pin chat");
  });
});
