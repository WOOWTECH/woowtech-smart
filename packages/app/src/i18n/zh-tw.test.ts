import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "./i18next";

function flattenStrings(value: unknown, prefix = "", out = new Map<string, string>()) {
  if (typeof value === "string") {
    out.set(prefix, value);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function placeholders(text: string): string {
  return [...new Set(text.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [])].sort().join(" ");
}

// Common characters that only exist in Simplified Chinese.
const SIMPLIFIED_ONLY = new Set(
  "这个们时为发开关删连线输击览与会录选项显数据错误请帮应从当过进还让对实现动态区条务设认装载编辑标签页户网络称创构读写视频图并无将样么于",
);

function hasSimplifiedOnlyCharacter(text: string): boolean {
  return [...text].some((character) => SIMPLIFIED_ONLY.has(character));
}

function traditional(): Map<string, string> {
  return flattenStrings(i18n.getResourceBundle("zh-TW", "translation"));
}

/** English as loaded: upstream's strings and woowtech smart's own. */
function english(): Map<string, string> {
  return flattenStrings(i18n.getResourceBundle("en", "translation"));
}

function inTraditional(key: string, options: Record<string, unknown> = {}): string {
  return i18n.t(key, { lng: "zh-TW", ...options });
}

describe("Traditional Chinese (zh-TW)", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("translates every English string", () => {
    expect([...traditional().keys()].sort()).toEqual([...english().keys()].sort());
  });

  it("keeps every interpolation placeholder", () => {
    const source = english();
    const mismatched = [...traditional()].filter(
      ([key, text]) => placeholders(text) !== placeholders(source.get(key) ?? ""),
    );
    expect(mismatched).toEqual([]);
  });

  it("contains no Simplified-only characters", () => {
    const simplified = [...traditional()].filter(([, text]) => hasSimplifiedOnlyCharacter(text));
    expect(simplified).toEqual([]);
  });

  it("reads as Taiwanese Traditional Chinese with the product name", () => {
    expect(inTraditional("onboarding.title")).toBe("歡迎使用渥屋智能");
    expect(inTraditional("settings.host.daemon.update.desktopManagedHint")).toBe(
      "此 Daemon 由渥屋智能桌面版管理。請在主機上更新渥屋智能桌面版。",
    );
    expect(inTraditional("shell.commandCenter.placeholder")).toBe(
      "搜尋指令、檔案、工作區和 Agent...",
    );
    expect(inTraditional("pairing.connectionMethods.scanQr.title")).toBe("掃描 QR Code");
    expect(inTraditional("pairing.remoteSsh.errors.failedToConnect", { detail: "" })).toBe(
      "無法透過 SSH 連線。",
    );
    expect(inTraditional("sidebar.help.shortcuts")).toBe("鍵盤快速鍵");
  });

  it("says in Taiwanese terms what testers read as English nouns", () => {
    expect(inTraditional("sidebar.actions.addProject")).toBe("新增專案");
    expect(inTraditional("openProject.tiles.setupProviders.title")).toBe("設定供應商");
    expect(inTraditional("settings.hostSections.workspaces")).toBe("工作區");
    expect(inTraditional("settings.hostSections.terminals")).toBe("終端機");
    expect(inTraditional("pairing.direct.helper")).toBe("輸入渥屋智能伺服器的位址。");
  });

  it("says a daemon the desktop attached to is 已連線, as every other connection is", () => {
    expect(inTraditional("desktop.daemon.lifecycle.attached")).toBe("已連線到現有的 daemon");
    expect(inTraditional("desktop.daemon.lifecycle.pauseAttached")).toBe(
      "要暫停自動管理 daemon 嗎？已連線的 daemon 會繼續執行。",
    );
  });

  it("calls browser tabs 分頁 and workspace labels 標籤", () => {
    expect(inTraditional("workspace.tabs.menu.closeOthers")).toBe("關閉其他分頁");
    expect(inTraditional("workspaceLabels.manage.open")).toBe("管理標籤…");
  });
});
