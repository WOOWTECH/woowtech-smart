import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  showNotificationWithDelivery,
  type NotificationDeliveryPort,
} from "./woowtech-notification-delivery.js";

class FakeNotification extends EventEmitter implements NotificationDeliveryPort {
  showCalls = 0;
  closeCalls = 0;
  showError = false;
  show(): void {
    this.showCalls += 1;
    if (this.showError) throw new Error("native show failed");
  }
  close(): void {
    this.closeCalls += 1;
  }
}

function fixture() {
  const notification = new FakeNotification();
  const timers = new Set<() => void>();
  let clicks = 0;
  let releases = 0;
  const input = {
    notification,
    onClick: () => {
      clicks += 1;
    },
    release: () => {
      releases += 1;
    },
    schedule: (callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(5_000);
      timers.add(callback);
      return () => {
        timers.delete(callback);
      };
    },
  };
  return { notification, timers, input, clicks: () => clicks, releases: () => releases };
}

describe("woowtech notification delivery", () => {
  it("preserves click routing after show until click releases the notification", async () => {
    const f = fixture();
    const result = showNotificationWithDelivery(f.input);
    f.notification.emit("show");
    expect(await result).toBe(true);
    expect(f.timers.size).toBe(0);
    expect(f.releases()).toBe(0);
    expect(f.notification.listenerCount("show")).toBe(0);
    expect(f.notification.listenerCount("click")).toBe(1);
    f.notification.emit("click");
    f.notification.emit("close");
    expect(f.clicks()).toBe(1);
    expect(f.releases()).toBe(1);
    expect(f.notification.eventNames()).toEqual([]);
  });

  it("releases shown notifications on close or subsequent native failure", async () => {
    for (const event of ["close", "failed"]) {
      const f = fixture();
      const result = showNotificationWithDelivery(f.input);
      f.notification.emit("show");
      f.notification.emit(event);
      expect(await result).toBe(true);
      expect(f.releases()).toBe(1);
      expect(f.notification.eventNames()).toEqual([]);
    }
  });

  it("treats a silent timeout as unconfirmed and clears listeners and references", async () => {
    const f = fixture();
    const result = showNotificationWithDelivery(f.input);
    expect(f.timers.size).toBe(1);
    for (const callback of f.timers) callback();
    expect(await result).toBe(false);
    expect(f.notification.closeCalls).toBe(1);
    expect(f.timers.size).toBe(0);
    expect(f.releases()).toBe(1);
    expect(f.notification.eventNames()).toEqual([]);
    f.notification.emit("show");
    expect(await result).toBe(false);
  });

  it("handles synchronous native show errors", async () => {
    const f = fixture();
    f.notification.showError = true;
    expect(await showNotificationWithDelivery(f.input)).toBe(false);
    expect(f.timers.size).toBe(0);
    expect(f.releases()).toBe(1);
    expect(f.notification.eventNames()).toEqual([]);
  });

  it("settles once when failed is followed by show or duplicate failure", async () => {
    const f = fixture();
    const result = showNotificationWithDelivery(f.input);
    f.notification.emit("failed");
    f.notification.emit("show");
    f.notification.emit("failed");
    expect(await result).toBe(false);
    expect(f.releases()).toBe(1);
    expect(f.clicks()).toBe(0);
    expect(f.timers.size).toBe(0);
  });

  it("does not claim delivery if closed before show", async () => {
    const f = fixture();
    const result = showNotificationWithDelivery(f.input);
    f.notification.emit("close");
    expect(await result).toBe(false);
    expect(f.releases()).toBe(1);
    expect(f.notification.eventNames()).toEqual([]);
  });
  it("waits for the asynchronous native result instead of treating show() return as delivery", async () => {
    const f = fixture();
    const results: boolean[] = [];
    const result = showNotificationWithDelivery(f.input);
    void result.then((value) => results.push(value));
    await Promise.resolve();
    expect(results).toEqual([]);
    f.notification.emit("failed");
    expect(await result).toBe(false);
    expect(f.releases()).toBe(1);
    expect(f.timers.size).toBe(0);
    expect(f.notification.eventNames()).toEqual([]);
  });
});
