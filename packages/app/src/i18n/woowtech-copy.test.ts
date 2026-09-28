import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "./i18next";
import { woowtechCopyFor } from "./woowtech-copy";

// Text upstream hardcodes in English, which these files now read from the
// woowtech.* translations. An upstream merge can bring a literal back.
const REPLACED_ENGLISH: Readonly<Record<string, readonly string[]>> = {
  "components/hosts/host-picker.tsx": [
    '"Add host"',
    '"All hosts"',
    '"Enable built-in daemon"',
    'searchPlaceholder="Search hosts"',
    'title ?? "Host"',
  ],
  "components/hosts/host-filter.tsx": ['title="Filter by host"', "`Filter: ${selectedHostLabel}`"],
  "components/add-project-flow.tsx": [
    '"Add project"',
    '"Search for directory"',
    '"Clone from GitHub"',
    '"Choose host"',
    '"No connected hosts"',
    '"Unable to add project"',
    '"Unable to clone repository"',
    '"Search directories or enter a path..."',
    '"Cloning project..."',
    '"Creating directory..."',
    'accessibilityLabel="Back"',
    'action="Navigate"',
    'action="Select"',
    "Loading...",
  ],
  "add-project-flow/options.ts": [
    '"Search for directory"',
    '"Clone from GitHub"',
    '"New directory"',
  ],
  "components/left-sidebar.tsx": [">Workspaces<", '"Display preferences"'],
  "screens/settings/browser-tools-card.tsx": ['"Enable browser tools"'],
  "screens/settings/host-page.tsx": [
    ">Archive merged PR workspaces<",
    '"Archive merged PR workspaces"',
    "Automatically archive clean",
    '"Unable to update workspaces"',
    ">Enable terminal agent hooks<",
    '"Enable terminal agent hooks"',
    "Get notifications and status from terminal agents",
    '"Unable to update terminal agent hooks"',
    '"Terminal agents"',
    '"Unknown error"',
  ],
};

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

  it("translates existing copy in every language and new surfaces in Chinese", () => {
    const english = woowtechCopy("en");
    expect(english.size).toBeGreaterThan(0);
    for (const language of Object.keys(i18n.store.data)) {
      if (language === "en") continue;
      const copy = woowtechCopy(language);
      const untranslated = [...english].flatMap(([key, text]) => {
        const newSurface = key.startsWith("addProject.") || key.startsWith("hostPicker.");
        if (newSurface && !["zh-TW", "zh-CN"].includes(language)) return [];
        // These newer fork surfaces are translated only in Traditional Chinese.
        const traditionalChineseOnly =
          key.startsWith("desktopNotifications.") ||
          key.startsWith("agentNotificationTitles.") ||
          key.startsWith("metadataGeneration.") ||
          key.startsWith("confirmDialog.") ||
          key.startsWith("claudeSdk.") ||
          key.startsWith("claudeAuth.");
        if (traditionalChineseOnly && language !== "zh-TW") return [];
        return copy.get(key) && copy.get(key) !== text ? [] : [key];
      });
      expect({ language, untranslated }).toEqual({ language, untranslated: [] });
    }
  });

  it("replaces upstream's hardcoded English", () => {
    const hardcoded: string[] = [];
    for (const [file, literals] of Object.entries(REPLACED_ENGLISH)) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      for (const literal of literals) {
        if (source.includes(literal)) hardcoded.push(`${file}: ${literal}`);
      }
    }
    expect(hardcoded).toEqual([]);
  });
});

it("keeps fork project-copy keys and placeholders in every locale with English fallback", () => {
  const english = woowtechCopy("en");
  expect(woowtechCopyFor("unknown-locale")).toEqual(woowtechCopyFor("en"));
  expect(english.get("addProject.searchDirectoryDescription")).toBe("Find a directory on {{host}}");
  const placeholders = (text: string) => (text.match(/\{\{[^}]*\}\}/g) ?? []).sort();
  for (const language of Object.keys(i18n.store.data)) {
    const copy = woowtechCopy(language);
    expect([...copy.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, text] of english) {
      expect({ language, key, placeholders: placeholders(copy.get(key) ?? "") }).toEqual({
        language,
        key,
        placeholders: placeholders(text),
      });
      if (
        (key.startsWith("addProject.") || key.startsWith("hostPicker.")) &&
        !["zh-TW", "zh-CN"].includes(language)
      ) {
        expect(copy.get(key)).toBe(text);
      }
    }
  }
});

it("localizes only agent notification titles in Traditional Chinese with English fallback", () => {
  const titles = ["finished", "permission", "attention"];
  for (const language of [...Object.keys(i18n.store.data), "unknown-locale"]) {
    const copy = new Map(strings(woowtechCopyFor(language)));
    const expected =
      language === "zh-TW"
        ? ["工作完成了", "需要你的授權", "需要你的注意"]
        : ["Agent finished", "Agent needs permission", "Agent needs attention"];
    expect(titles.map((reason) => copy.get(`agentNotificationTitles.${reason}`))).toEqual(expected);
  }
});

it("keeps desktop notification feedback exact with English fallback outside zh-TW", () => {
  const english = {
    supported: "Notifications are supported; system permission has not been confirmed.",
    unknown: "System notification permission could not be checked.",
    testHint: "Try a notification to check delivery. System permission is not confirmed.",
    send: "Test notification",
    successTitle: "Notification displayed",
    successDescription:
      "The system reported display, but this does not confirm that you saw a banner.",
    failedTitle: "Notification failed",
    unconfirmedTitle: "Unable to confirm notification display",
    unconfirmed:
      "Check System Settings → Notifications. Unsigned test builds may be unable to display notifications.",
    failed:
      "Check System Settings → Notifications. Unsigned test builds may be unable to display notifications.",
  };
  expect(woowtechCopyFor("zh-TW").desktopNotifications).toEqual({
    supported: "系統支援通知，但尚未確認系統授權狀態。",
    unknown: "無法確認系統通知的授權狀態。",
    testHint: "可傳送測試通知來檢查是否顯示；目前尚未確認系統授權。",
    send: "傳送測試通知",
    successTitle: "通知已顯示",
    successDescription: "系統已回報顯示通知，但不代表你一定看到了通知橫幅。",
    failedTitle: "通知顯示失敗",
    unconfirmedTitle: "無法確認通知是否顯示",
    unconfirmed: "請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
    failed: "請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
  });
  for (const language of [...Object.keys(i18n.store.data), "unknown-locale"]) {
    const copy = woowtechCopyFor(language).desktopNotifications;
    if (language !== "zh-TW") expect(copy).toEqual(english);
    for (const text of Object.values(copy)) expect(text.match(/\{\{[^}]*\}\}/g)).toBeNull();
  }
});

it("explains inactive metadata preferences in zh-TW and English without changing old translations", () => {
  const english = {
    projectInfo:
      "woowtech smart currently does not automatically generate workspace titles, branch names, commit messages or PR drafts. Saved project instructions are retained but are not used for automatic generation.",
    description:
      "woowtech smart currently does not automatically generate workspace titles, branch names, commit messages or PR drafts. Saved model preferences are retained but do not enable generation.",
    automaticHint: "Automatic model selection is inactive while generation is disabled.",
    preferredHint: "Saved model preferences are inactive while generation is disabled.",
    fallbackHint: "This preference is retained; no model is called for metadata generation.",
  };
  const traditionalChinese = {
    projectInfo:
      "woowtech smart 目前不會自動產生工作區標題、分支名稱、提交訊息或 PR 草稿。已儲存的專案指令會保留，但不會用於自動產生。",
    description:
      "woowtech smart 目前不會自動產生工作區標題、分支名稱、提交訊息或 PR 草稿。已儲存的模型偏好會保留，但不會啟用自動產生。",
    automaticHint: "自動產生已停用，目前不會自動選擇模型。",
    preferredHint: "自動產生已停用，目前不會套用已儲存的模型偏好。",
    fallbackHint: "此偏好會保留；不會呼叫任何模型來產生後設資料。",
  };
  for (const language of [...Object.keys(i18n.store.data), "unknown-locale"]) {
    const copy = new Map(strings(woowtechCopyFor(language)));
    const expected = language === "zh-TW" ? traditionalChinese : english;
    for (const [key, text] of Object.entries(expected)) {
      expect(copy.get(`metadataGeneration.${key}`)).toBe(text);
      expect(text.match(/\{\{[^}]*\}\}/g)).toBeNull();
    }
  }
  const page = readFileSync(
    join(__dirname, "../screens/settings/metadata-generation-page.tsx"),
    "utf8",
  );
  const projectPage = readFileSync(
    join(__dirname, "../screens/project-settings-screen.tsx"),
    "utf8",
  );
  expect(projectPage).toContain('info={t("woowtech.metadataGeneration.projectInfo")}');
  expect(projectPage).not.toContain('t("settings.project.metadata.info")');
  for (const key of Object.keys(english)) {
    if (key === "projectInfo") continue;
    expect(page).toContain(`t("woowtech.metadataGeneration.${key}")`);
    expect(page).not.toContain(`t("settings.metadataGeneration.${key}")`);
  }
});

it("provides Taiwanese page titles, placeholders, progress and local error wrappers", () => {
  const keys = [
    "title",
    "searchDirectory",
    "cloneGithub",
    "chooseHost",
    "chooseDestination",
    "chooseParent",
    "nameDirectory",
    "directoryName",
    "directoryPlaceholder",
    "parentPlaceholder",
    "githubPlaceholder",
    "noConnectedHosts",
    "adding",
    "cloning",
    "creatingDirectory",
    "directorySearchFailed",
    "githubSearchFailed",
    "addFailed",
    "createFailed",
    "browseFailed",
    "cloneFailed",
  ];
  expect(keys.map((key) => i18n.t(`woowtech.addProject.${key}`, { lng: "zh-TW" }))).toEqual([
    "新增專案",
    "搜尋資料夾",
    "從 GitHub 複製專案",
    "選擇主機",
    "選擇存放位置",
    "選擇上層資料夾",
    "命名資料夾",
    "資料夾名稱",
    "搜尋資料夾或輸入路徑…",
    "搜尋上層資料夾或輸入路徑…",
    "搜尋或輸入 GitHub 儲存庫…",
    "沒有已連線的主機",
    "正在新增專案…",
    "正在複製專案…",
    "正在建立資料夾…",
    "無法搜尋資料夾",
    "無法搜尋 GitHub 儲存庫",
    "無法新增專案",
    "無法建立資料夾",
    "無法瀏覽資料夾",
    "無法複製儲存庫",
  ]);
});

it("provides a generic Confirm default in zh-TW with English fallback and no placeholders", () => {
  for (const language of [...Object.keys(i18n.store.data), "unknown-locale"]) {
    const copy = new Map(strings(woowtechCopyFor(language)));
    expect(copy.get("confirmDialog.confirm")).toBe(language === "zh-TW" ? "確認" : "Confirm");
    expect(copy.get("confirmDialog.confirm")?.match(/\{\{[^}]*\}\}/g)).toBeNull();
  }
});
