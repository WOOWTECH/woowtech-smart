import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "./i18next";

function allStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.values(value).flatMap(allStrings);
}

describe("product name in translations", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("names woowtech smart in English", () => {
    expect(i18n.t("onboarding.title", { lng: "en" })).toBe("Welcome to woowtech smart");
    expect(i18n.t("settings.host.daemon.update.desktopManagedHint", { lng: "en" })).toBe(
      "This daemon is managed by woowtech smart Desktop. Update woowtech smart Desktop on the host.",
    );
  });

  it("names 渥屋智能 in Chinese, joined to the Chinese around it", () => {
    expect(i18n.t("onboarding.title", { lng: "zh-CN" })).toBe("欢迎使用渥屋智能");
    expect(i18n.t("settings.host.daemon.update.desktopManagedHint", { lng: "zh-CN" })).toBe(
      "此 Daemon 由渥屋智能桌面版管理。请在 Host 上更新渥屋智能桌面版。",
    );
    expect(i18n.t("desktop.integrations.cli.installFailed", { lng: "zh-CN" })).toBe(
      "无法安装渥屋智能 CLI。",
    );
    expect(i18n.t("toolCallGroup.paseoCalls.other", { lng: "zh-CN", count: 2 })).toBe(
      "调用了渥屋智能 2 次",
    );
  });

  it("keeps technical names that only look like the product name", () => {
    expect(i18n.t("settings.project.scripts.serviceHint", { lng: "en" })).toBe(
      "woowtech smart supervises the process and assigns a port via $PASEO_PORT",
    );
  });

  it("leaves no translation naming Paseo, including strings upstream adds later", () => {
    for (const language of Object.keys(i18n.store.data)) {
      const naming = allStrings(i18n.getResourceBundle(language, "translation")).filter((text) =>
        text.includes("Paseo"),
      );
      expect({ language, naming }).toEqual({ language, naming: [] });
    }
  });
});
