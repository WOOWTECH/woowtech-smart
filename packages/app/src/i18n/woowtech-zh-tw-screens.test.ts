import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import { i18n } from "./i18next";
import { followDocumentLanguage } from "./woowtech-document-language.web";
import {
  CADENCE_PRESET_OPTIONS,
  resolveCronPresetDisplay,
} from "@/schedules/schedule-cadence-options";
import { resolveWorkspaceRouteState } from "@/screens/workspace/workspace-route-state";
import { formatConnectionStatus } from "@/utils/daemons";
import { toErrorMessage } from "@/utils/error-messages";
import {
  formatCadence,
  formatNextRun,
  resolveScheduleTitle,
  scheduleCopy,
  validateCron,
} from "@/utils/schedule-format";
import { describeCompactTimeAgo, formatDuration, formatTimeAgo } from "@/utils/time";

// The text of the screens the Android and desktop rounds found in English under zh-TW.
// Shared formatters read the app language, so this switches the whole i18n instance.

const now = new Date("2026-09-27T12:00:00.000Z");

function schedule(target: "agent" | "new-agent"): ScheduleSummary {
  return {
    id: "sch_1",
    name: null,
    prompt: "   ",
    cadence: { type: "cron", expression: "0 9 * * 1-5", timezone: "Asia/Taipei" },
    target:
      target === "agent"
        ? { type: "agent", agentId: "agent_1" }
        : {
            type: "new-agent",
            config: { provider: "claude", cwd: "/tmp/proj", title: null },
          },
    status: "active",
    createdAt: "2026-09-27T11:59:50.000Z",
    updatedAt: "2026-09-27T11:59:50.000Z",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runCount: 0,
  } as unknown as ScheduleSummary;
}

describe("zh-TW text on the screens the device rounds found in English", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-TW");
  });

  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names schedules 排程 in the sidebar and page title", () => {
    expect(i18n.t("sidebar.sections.schedules")).toBe("排程");
    expect(i18n.t("woowtech.schedules.newSchedule")).toBe("新增排程");
  });

  it("describes cadences, runs and cron errors in Traditional Chinese", () => {
    expect(
      formatCadence({ type: "cron", expression: "0 9 * * 1-5", timezone: "Asia/Taipei" }),
    ).toBe("平日 09:00（Asia/Taipei）");
    expect(formatCadence({ type: "cron", expression: "0 9 * * 1" })).toBe("每週一 09:00（UTC）");
    expect(formatCadence({ type: "cron", expression: "15 * * * *" })).toBe("每小時的第 15 分");
    expect(formatCadence({ type: "every", everyMs: 2 * 60 * 60_000 })).toBe("每 2 小時");
    expect(validateCron("")).toBe("請輸入 cron 運算式");
    expect(validateCron("* * *")).toBe("Cron 運算式必須有 5 個欄位");
    expect(validateCron("60 * * * *")).toBe("分鐘的數值無效");
    expect(validateCron("* * 31-1 * *")).toBe("日期的範圍無效");
    expect(formatNextRun(new Date(Date.now() + 30 * 60_000).toISOString())).toBe("30 分鐘後");
    expect(CADENCE_PRESET_OPTIONS.map((option) => option.label)).toEqual([
      "每分鐘",
      "每小時",
      "每天 9:00",
      "平日 9:00",
      "每週一 9:00",
    ]);
    expect(
      resolveCronPresetDisplay({ type: "cron", expression: "*/5 * * * *", timezone: "UTC" }),
    ).toEqual({ label: "自訂 cron" });
  });

  it("words schedules and heartbeats in Traditional Chinese", () => {
    expect(resolveScheduleTitle(schedule("new-agent"))).toBe("未命名排程");
    expect(resolveScheduleTitle(schedule("agent"))).toBe("未命名心跳");
    expect(scheduleCopy(schedule("agent"), "delete")).toBe("刪除心跳");
    expect(scheduleCopy(schedule("new-agent"), "editTitle", { title: "早報" })).toBe(
      "編輯排程 早報",
    );
  });

  it("says how long ago and for how long in Traditional Chinese", () => {
    expect(formatTimeAgo(new Date("2026-09-27T11:59:55.000Z"), now)).toBe("剛剛");
    expect(formatTimeAgo(new Date("2026-09-27T11:59:30.000Z"), now)).toBe("30 秒前");
    expect(formatTimeAgo(new Date("2026-09-27T11:55:00.000Z"), now)).toBe("5 分鐘前");
    expect(formatTimeAgo(new Date("2026-09-24T12:00:00.000Z"), now)).toBe("3 天前");
    expect(formatTimeAgo(new Date("2026-01-15T12:00:00.000Z"), now)).toBe("1月15日");
    expect(describeCompactTimeAgo(new Date("2026-09-27T11:59:30.000Z"), now).label).toBe("剛剛");
    expect(describeCompactTimeAgo(new Date("2026-09-27T10:00:00.000Z"), now).label).toBe("2 小時");
    expect(formatDuration(15_000)).toBe("15 秒");
    expect(formatDuration(132_000)).toBe("2 分 12 秒");
    expect(formatDuration(3_900_000)).toBe("1 小時 5 分");
    expect(i18n.t("woowtech.message.workedFor", { duration: formatDuration(25_000) })).toBe(
      "工作了 25 秒",
    );
  });

  it("shows the host status badge in Traditional Chinese", () => {
    expect(formatConnectionStatus("online")).toBe("線上");
    expect(formatConnectionStatus("offline")).toBe("離線");
  });

  it("explains an unavailable workspace from its reason code", () => {
    const state = resolveWorkspaceRouteState({
      hostName: "Mac",
      connectionStatus: "online",
      lastError: null,
      workspace: null,
      hasHydratedWorkspaces: true,
      recovery: {
        kind: "unavailable",
        recovery: {
          kind: "unavailable",
          workspaceId: "wks_1",
          reason: "workspace_not_found",
          message: "This workspace is no longer known to the host.",
        },
      },
    });
    expect(state).toEqual({
      kind: "recoveryUnavailable",
      hostName: "Mac",
      message: "主機上已經沒有這個工作區。",
    });
    const newerReason = resolveWorkspaceRouteState({
      hostName: "Mac",
      connectionStatus: "online",
      lastError: null,
      workspace: null,
      hasHydratedWorkspaces: true,
      recovery: {
        kind: "unavailable",
        recovery: {
          kind: "unavailable",
          workspaceId: "wks_1",
          reason: "a_reason_from_a_newer_daemon",
          message: "Explained by the daemon.",
        },
      },
    });
    expect(newerReason).toEqual({
      kind: "recoveryUnavailable",
      hostName: "Mac",
      message: "Explained by the daemon.",
    });
  });

  it("keeps the daemon's own words in a language without its own text", async () => {
    await i18n.changeLanguage("ja");
    try {
      expect(
        resolveWorkspaceRouteState({
          hostName: "Mac",
          connectionStatus: "online",
          lastError: null,
          workspace: null,
          hasHydratedWorkspaces: true,
          recovery: {
            kind: "unavailable",
            recovery: {
              kind: "unavailable",
              workspaceId: "wks_1",
              reason: "workspace_not_found",
              message: "Worded by this daemon.",
            },
          },
        }),
      ).toEqual({
        kind: "recoveryUnavailable",
        hostName: "Mac",
        message: "Worded by this daemon.",
      });
    } finally {
      await i18n.changeLanguage("zh-TW");
    }
  });

  it("says the host is not connected instead of the client's transport error", () => {
    expect(toErrorMessage(new Error("Transport not connected (status: disconnected)"))).toBe(
      "主機未連線",
    );
    expect(
      toErrorMessage(
        Object.assign(new Error("Connection lost"), {
          name: "DaemonConnectionError",
          code: "DAEMON_CONNECTION_LOST",
        }),
      ),
    ).toBe("主機未連線");
    expect(toErrorMessage(new Error("WebSocket not open (readyState=3)"))).toBe("主機未連線");
    expect(toErrorMessage(new Error("Directory not found"))).toBe("Directory not found");
  });
});

describe("the document language", () => {
  it("follows the app language, so Chinese text is drawn and read as Traditional Chinese", () => {
    const listeners: Array<(language: string) => void> = [];
    const root = { lang: "en" };
    followDocumentLanguage(
      {
        language: "zh-TW",
        on: ((event: string, listener: (language: string) => void) => {
          if (event === "languageChanged") listeners.push(listener);
        }) as never,
      },
      root,
    );
    expect(root.lang).toBe("zh-TW");

    for (const listener of listeners) listener("ja");
    expect(root.lang).toBe("ja");
  });
});
