import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  canTestNotification,
  runNotificationTest,
  type TestNotificationState,
} from "./woowtech-notification-test";

describe("woowtech notification test feedback", () => {
  it("allows testing unknown permission but not unavailable or pending status", () => {
    expect(canTestNotification("unknown")).toBe(true);
    expect(canTestNotification("granted")).toBe(true);
    expect(canTestNotification("unavailable")).toBe(false);
    expect(canTestNotification(undefined)).toBe(false);
  });

  it("keeps pending until delivery and reports actionable Traditional Chinese failure", async () => {
    const states: TestNotificationState[] = [];
    let complete = (_delivered: boolean) => {};
    const sending = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    const t = i18n.getFixedT("zh-TW");
    const run = runNotificationTest({
      send: () => sending,
      failureMessage: t("woowtech.desktopNotifications.failed"),
      onState: (state) => states.push(state),
    });
    expect(states).toEqual([{ status: "sending" }]);
    complete(false);
    await run;
    expect(states).toEqual([
      { status: "sending" },
      {
        status: "error",
        message:
          "無法確認通知是否顯示。請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
      },
    ]);
  });

  it("maps IPC rejection to the same actionable failure", async () => {
    const states: TestNotificationState[] = [];
    await runNotificationTest({
      send: async () => {
        throw new Error("IPC failed");
      },
      failureMessage: "check notification settings",
      onState: (state) => states.push(state),
    });
    expect(states).toEqual([
      { status: "sending" },
      { status: "error", message: "check notification settings" },
    ]);
  });

  it("acknowledges show without claiming a visible banner", async () => {
    const states: TestNotificationState[] = [];
    await runNotificationTest({
      send: async () => true,
      failureMessage: "failure",
      onState: (state) => states.push(state),
    });
    expect(states).toEqual([{ status: "sending" }, { status: "success" }]);
    const t = i18n.getFixedT("zh-TW");
    expect(t("woowtech.desktopNotifications.successTitle")).toBe("系統已回報通知顯示");
    expect(t("woowtech.desktopNotifications.successDescription")).toBe(
      "系統已回報顯示通知，但不代表你一定看到了通知橫幅。",
    );
  });
});
