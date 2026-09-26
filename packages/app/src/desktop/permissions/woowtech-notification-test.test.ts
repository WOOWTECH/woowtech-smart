import { describe, expect, it } from "vitest";
import type { DesktopNotificationBridge, NotificationDeliveryResult } from "@/desktop/host";
import { i18n } from "@/i18n/i18next";
import {
  canTestNotification,
  runNotificationTest,
  sendDesktopTestNotification,
  type TestNotificationState,
} from "./woowtech-notification-test";

describe("woowtech notification test feedback", () => {
  it("reports timeout as unconfirmed instead of success or failure", async () => {
    const states: TestNotificationState[] = [];
    await runNotificationTest({
      send: async () => "unconfirmed",
      failureMessage: "delivery failed",
      unconfirmedMessage: i18n.getFixedT("zh-TW")("woowtech.desktopNotifications.unconfirmed"),
      onState: (state) => states.push(state),
    });
    expect(states).toEqual([
      { status: "sending" },
      {
        status: "unconfirmed",
        message: "請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
      },
    ]);
  });
  it("uses the result bridge once and passes all three results and payload unchanged", async () => {
    const payload = { title: "test title", body: "test body" };
    const results: NotificationDeliveryResult[] = ["shown", "failed", "unconfirmed"];
    for (const result of results) {
      const sent: unknown[] = [];
      let legacyCalls = 0;
      const bridge: DesktopNotificationBridge = {
        sendNotificationWithResult: async (input) => {
          sent.push(input);
          return result;
        },
        sendNotification: async () => {
          legacyCalls += 1;
          return true;
        },
      };
      expect(await sendDesktopTestNotification({ bridge, payload })).toBe(result);
      expect(sent).toEqual([payload]);
      expect(legacyCalls).toBe(0);
    }
  });

  it("retains old bridge sending without claiming that a legacy boolean proves display", async () => {
    for (const result of [true, false]) {
      let calls = 0;
      const bridge: DesktopNotificationBridge = {
        sendNotification: async () => {
          calls += 1;
          return result;
        },
      };
      expect(await sendDesktopTestNotification({ bridge, payload: { title: "test" } })).toBe(
        "unconfirmed",
      );
      expect(calls).toBe(1);
    }
    expect(
      await sendDesktopTestNotification({ bridge: undefined, payload: { title: "test" } }),
    ).toBe("failed");
  });

  it("does not retry through the legacy bridge after a new bridge failure", async () => {
    let legacyCalls = 0;
    const bridge: DesktopNotificationBridge = {
      sendNotificationWithResult: async () => {
        throw new Error("IPC failed");
      },
      sendNotification: async () => {
        legacyCalls += 1;
        return true;
      },
    };
    await expect(
      sendDesktopTestNotification({ bridge, payload: { title: "test" } }),
    ).rejects.toThrow("IPC failed");
    expect(legacyCalls).toBe(0);
  });

  it("allows testing unknown permission but not unavailable or pending status", () => {
    expect(canTestNotification("unknown")).toBe(true);
    expect(canTestNotification("granted")).toBe(true);
    expect(canTestNotification("unavailable")).toBe(false);
    expect(canTestNotification(undefined)).toBe(false);
  });

  it("keeps pending until delivery and reports actionable Traditional Chinese failure", async () => {
    const states: TestNotificationState[] = [];
    let complete = (_delivered: NotificationDeliveryResult) => {};
    const sending = new Promise<NotificationDeliveryResult>((resolve) => {
      complete = resolve;
    });
    const t = i18n.getFixedT("zh-TW");
    const run = runNotificationTest({
      send: () => sending,
      failureMessage: t("woowtech.desktopNotifications.failed"),
      unconfirmedMessage: t("woowtech.desktopNotifications.unconfirmed"),
      onState: (state) => states.push(state),
    });
    expect(states).toEqual([{ status: "sending" }]);
    complete("failed");
    await run;
    expect(states).toEqual([
      { status: "sending" },
      {
        status: "error",
        message: "請到「系統設定 → 通知」檢查；未簽章的測試版可能無法顯示通知。",
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
      unconfirmedMessage: "cannot confirm",
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
      send: async () => "shown",
      failureMessage: "failure",
      unconfirmedMessage: "cannot confirm",
      onState: (state) => states.push(state),
    });
    expect(states).toEqual([{ status: "sending" }, { status: "success" }]);
    const t = i18n.getFixedT("zh-TW");
    expect(t("woowtech.desktopNotifications.successTitle")).toBe("通知已顯示");
    expect(t("woowtech.desktopNotifications.successDescription")).toBe(
      "系統已回報顯示通知，但不代表你一定看到了通知橫幅。",
    );
  });
});
