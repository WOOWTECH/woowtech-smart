import { beforeAll, describe, expect, it } from "vitest";
import { rebrandResources } from "./brand";
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

// The official Paseo owns the `paseo` command, and ours is woowtech-smart.
// Deliberately wider than the rewrite: it also catches a command upstream adds
// later and a mention written without a space before it.
const UPSTREAM_COMMAND = /(?<![\w.@/$~-])paseo(?= +(?:[a-z<[]|-))/;

describe("CLI commands in translations", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("show the woowtech-smart command in every language", () => {
    expect(i18n.t("desktop.daemon.fullStatus.hint", { lng: "en" })).toBe(
      "Runs `woowtech-smart daemon status` and shows the output",
    );
    expect(i18n.t("desktop.daemon.fullStatus.hint", { lng: "zh-TW" })).toBe(
      "執行 `woowtech-smart daemon status` 並顯示輸出",
    );
    expect(i18n.t("desktop.daemon.fullStatus.hint", { lng: "ja" })).toBe(
      "`woowtech-smart daemon status`を実行して出力を表示します",
    );
    expect(i18n.t("desktop.daemon.fullStatus.hint", { lng: "ar" })).toBe(
      "يقوم بتشغيل`woowtech-smart daemon status`ويظهر الإخراج",
    );
  });

  it("leave no translation showing the paseo command, including strings upstream adds later", () => {
    for (const language of Object.keys(i18n.store.data)) {
      const commands = allStrings(i18n.getResourceBundle(language, "translation")).filter((text) =>
        UPSTREAM_COMMAND.test(text),
      );
      expect({ language, commands }).toEqual({ language, commands: [] });
    }
  });

  it("keep interpolated values, even ones that read like the command", () => {
    expect(
      i18n.t("workspace.git.forgeSetup.signIn", {
        lng: "en",
        command: "paseo daemon status",
        brand: "GitHub",
      }),
    ).toBe("Run paseo daemon status to use GitHub features.");
  });

  it("keep file names, variables, packages, links and placeholders that only look like the command", () => {
    const technical = [
      "Couldn't load paseo.json",
      "Leave blank to use paseo-plugin.json",
      "assigns a port via $PASEO_PORT",
      "PASEO_HOME points at ~/.paseo",
      "npm install @getpaseo/cli",
      "https://paseo.sh/docs/plugins",
      "Open paseo://agent/1",
      "Run {{paseo}} daemon status",
    ];
    const keys = technical.map((_, index) => `t${index}`);
    const translation = Object.fromEntries(keys.map((key, index) => [key, technical[index]]));

    for (const language of ["en", "zh-TW"]) {
      const rebranded = rebrandResources({ [language]: { translation } })[language]?.translation;
      const texts = keys.map((key) => (typeof rebranded === "object" ? rebranded[key] : undefined));
      expect({ language, texts }).toEqual({ language, texts: technical });
    }
  });
});

// The help menu's Discord and GitHub items open WoowTech's website and support
// email instead. (Until 2026-09-26 the Discord item opened our LINE official
// account; the owner retired that channel.)
const HELP_CHANNEL_KEYS = [
  "sidebar.help.discord",
  "sidebar.help.github",
  "startup.errorDescription",
];

function upstreamHelpChannels(language: string): string[] {
  return HELP_CHANNEL_KEYS.map((key) => i18n.t(key, { lng: language })).filter((text) =>
    /Discord|GitHub|LINE/.test(text),
  );
}

describe("help channels in translations", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("names the website and support email", () => {
    expect(i18n.t("sidebar.help.discord", { lng: "en" })).toBe("Official website");
    expect(i18n.t("sidebar.help.github", { lng: "en" })).toBe("Email support");
    expect(i18n.t("sidebar.help.discord", { lng: "zh-TW" })).toBe("官方網站");
    expect(i18n.t("sidebar.help.github", { lng: "zh-TW" })).toBe("寄信給客服");
    expect(i18n.t("startup.errorDescription", { lng: "zh-TW" })).toBe(
      "本機伺服器啟動失敗。如果持續發生，請寄信給客服並附上下方記錄。",
    );
  });

  it("sends no language to Discord, GitHub or LINE for help", () => {
    for (const language of Object.keys(i18n.store.data)) {
      expect({ language, upstream: upstreamHelpChannels(language) }).toEqual({
        language,
        upstream: [],
      });
    }
  });
});
