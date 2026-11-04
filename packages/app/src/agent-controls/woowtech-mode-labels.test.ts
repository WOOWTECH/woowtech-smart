import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "@getpaseo/protocol/provider-manifest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatAgentModeLabel } from "./labels";
import { woowtechModeLabel } from "./woowtech-mode-labels";

describe("mode names in Traditional Chinese", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("names Claude's modes in the composer's language", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(formatAgentModeLabel({ id: "default", label: "Always Ask" })).toBe("一律詢問");
    expect(formatAgentModeLabel({ id: "acceptEdits", label: "Accept File Edits" })).toBe(
      "自動接受檔案編輯",
    );
    expect(formatAgentModeLabel({ id: "bypassPermissions", label: "Bypass" })).toBe("略過權限");
  });

  it("keeps upstream's formatting in English", () => {
    expect(formatAgentModeLabel({ id: "default", label: "Always Ask" })).toBe("Always ask");
  });

  it("formats a name it does not know as upstream does", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(formatAgentModeLabel({ id: "yolo", label: "YOLO mode" })).toBe("Yolo mode");
  });

  // A provider that renames a mode would silently fall back to English: every mode the built-in
  // providers send has a Traditional Chinese name.
  it("covers every mode of the built-in providers", () => {
    const labels = [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS]
      .filter((provider) => !provider.id.startsWith("mock"))
      .flatMap((provider) => provider.modes ?? [])
      .map((mode) => mode.label);
    expect(labels.length).toBeGreaterThan(10);
    expect(labels.filter((label) => woowtechModeLabel(label, "zh-TW") == null)).toEqual([]);
  });
});
