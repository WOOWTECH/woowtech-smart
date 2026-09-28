import { describe, expect, it } from "vitest";
import {
  buildAgentAttentionNotificationPayload,
  type AgentAttentionNotificationPayload,
} from "@getpaseo/protocol/agent-attention-notification";
import { i18n } from "@/i18n/i18next";
import { localizeAgentNotification } from "./woowtech-agent-notification";

const notification: AgentAttentionNotificationPayload = {
  title: "Agent finished",
  body: "Agent output: Finished working.",
  data: {
    serverId: "test-server",
    workspaceId: "test-workspace",
    agentId: "test-agent",
    reason: "finished",
    extra: "untouched",
  },
};

describe("woowtech agent notification titles", () => {
  it("uses the supplied reason, never title or body text, to choose permission and attention", () => {
    const t = i18n.getFixedT("zh-TW");
    expect(localizeAgentNotification({ notification, reason: "permission", t })).toEqual({
      ...notification,
      title: "需要你的授權",
    });
    expect(localizeAgentNotification({ notification, reason: "error", t })).toEqual({
      ...notification,
      title: "需要你的注意",
    });
  });

  it("keeps old-daemon fallback and agent-authored fallback-looking bodies untouched", () => {
    const fallback = buildAgentAttentionNotificationPayload({
      reason: "finished",
      serverId: "test-server",
      workspaceId: "test-workspace",
      agentId: "test-agent",
    });
    const t = i18n.getFixedT("zh-TW");
    expect(localizeAgentNotification({ notification: fallback, reason: "finished", t })).toEqual({
      ...fallback,
      title: "工作完成了",
    });
    for (const body of [
      "Finished working.",
      "Permission requested.",
      "Agent finished",
      "工作完成了",
      "  exact whitespace\n",
    ]) {
      const original = { ...notification, body };
      expect(localizeAgentNotification({ notification: original, reason: "finished", t })).toEqual({
        ...original,
        title: "工作完成了",
      });
    }
  });

  it("uses the latest app language and retains upstream English titles in other locales", async () => {
    try {
      await i18n.changeLanguage("zh-TW");
      expect(localizeAgentNotification({ notification, reason: "finished", t: i18n.t }).title).toBe(
        "工作完成了",
      );
      await i18n.changeLanguage("en");
      expect(localizeAgentNotification({ notification, reason: "finished", t: i18n.t })).toEqual(
        notification,
      );
      for (const language of ["zh-CN", "ja", "ar"]) {
        const t = i18n.getFixedT(language);
        expect(localizeAgentNotification({ notification, reason: "permission", t }).title).toBe(
          "Agent needs permission",
        );
        expect(localizeAgentNotification({ notification, reason: "error", t }).title).toBe(
          "Agent needs attention",
        );
      }
    } finally {
      await i18n.changeLanguage("en");
    }
  });
  it("accepts the latest fixed translator rather than a translator captured before a language change", () => {
    const english = i18n.getFixedT("en");
    const traditionalChinese = i18n.getFixedT("zh-TW");
    expect(english("woowtech.agentNotificationTitles.finished")).toBe("Agent finished");
    expect(
      localizeAgentNotification({ notification, reason: "finished", t: traditionalChinese }),
    ).toEqual({
      ...notification,
      title: "工作完成了",
    });
    expect(localizeAgentNotification({ notification, reason: "finished", t: english })).toEqual(
      notification,
    );
  });

  it("translates the reason title without changing daemon preview or routing data", () => {
    const result = localizeAgentNotification({
      notification,
      reason: "finished",
      t: i18n.getFixedT("zh-TW"),
    });
    expect(result).toEqual({ ...notification, title: "工作完成了" });
    expect(result.data).toBe(notification.data);
    expect(notification.title).toBe("Agent finished");
  });
});
