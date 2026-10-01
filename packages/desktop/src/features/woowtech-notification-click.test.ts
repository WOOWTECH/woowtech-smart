import { describe, expect, it } from "vitest";
import {
  createNotificationClickRouter,
  type NotificationClickPayload,
  type NotificationClickWindow,
} from "./woowtech-notification-click.js";

interface FakeWindow extends NotificationClickWindow {
  sent: NotificationClickPayload[];
  shown: number;
  focused: number;
  restored: number;
  minimized: boolean;
  destroyed: boolean;
}

function fakeWindow(webContentsId: number): FakeWindow {
  const window: FakeWindow = {
    webContentsId,
    sent: [],
    shown: 0,
    focused: 0,
    restored: 0,
    minimized: false,
    destroyed: false,
    isDestroyed: () => window.destroyed,
    isMinimized: () => window.minimized,
    restore: () => {
      window.restored += 1;
      window.minimized = false;
    },
    show: () => {
      window.shown += 1;
    },
    focus: () => {
      window.focused += 1;
    },
    sendClick: (payload) => {
      window.sent.push(payload);
    },
  };
  return window;
}

function harness() {
  const windows: FakeWindow[] = [];
  let ensureCalls = 0;
  let nextId = 10;
  const router = createNotificationClickRouter({
    windowForWebContents: (id) =>
      windows.find((window) => window.webContentsId === id && !window.destroyed) ?? null,
    anyWindow: () => windows.find((window) => !window.destroyed) ?? null,
    ensureWindow: async () => {
      ensureCalls += 1;
      if (!windows.some((window) => !window.destroyed)) windows.push(fakeWindow(nextId++));
    },
  });
  return {
    router,
    windows,
    addWindow: (id: number) => {
      const window = fakeWindow(id);
      windows.push(window);
      return window;
    },
    ensureCalls: () => ensureCalls,
  };
}

const agent = { serverId: "s", workspaceId: "w", agentId: "a" };

describe("notification click router", () => {
  it("focuses the ready sender window and forwards the click data", async () => {
    const h = harness();
    const sender = h.addWindow(1);
    sender.minimized = true;
    h.router.rendererReady(1);
    await h.router.routeClick(1, agent);
    expect(sender.sent).toEqual([{ data: agent }]);
    expect([sender.restored, sender.shown, sender.focused]).toEqual([1, 1, 1]);
    expect(h.ensureCalls()).toBe(0);
  });

  it("falls back to another window when the sender closed", async () => {
    const h = harness();
    h.addWindow(1).destroyed = true;
    const other = h.addWindow(2);
    h.router.rendererReady(2);
    await h.router.routeClick(1, agent);
    expect(other.sent).toEqual([{ data: agent }]);
  });

  it("reopens the main window when every window is closed and queues the target for its renderer", async () => {
    const h = harness();
    h.addWindow(1).destroyed = true;
    await h.router.routeClick(1, agent);
    expect(h.ensureCalls()).toBe(1);
    const reopened = h.windows.find((window) => !window.destroyed);
    expect(reopened).toBeDefined();
    expect(reopened?.sent).toEqual([]);
    expect(reopened?.focused).toBe(1);
    expect(h.router.rendererReady(reopened!.webContentsId)).toEqual({ data: agent });
    expect(h.router.rendererReady(reopened!.webContentsId)).toBeNull();
  });

  it("queues while an existing window is still loading its renderer", async () => {
    const h = harness();
    const window = h.addWindow(1);
    h.router.rendererReady(1);
    h.router.windowLoading(1);
    await h.router.routeClick(1, agent);
    expect(window.sent).toEqual([]);
    expect(h.router.rendererReady(1)).toEqual({ data: agent });
    await h.router.routeClick(1, { terminalId: "t", serverId: "s" });
    expect(window.sent).toEqual([{ data: { terminalId: "t", serverId: "s" } }]);
  });

  it("only focuses or reopens for a click without routing data", async () => {
    const h = harness();
    await h.router.routeClick(1, undefined);
    await h.router.routeClick(1, {});
    expect(h.ensureCalls()).toBe(1);
    const window = h.windows[0];
    expect(window.focused).toBe(2);
    expect(h.router.rendererReady(window.webContentsId)).toBeNull();
  });

  it("drops a queued target when its window closes", async () => {
    const h = harness();
    h.addWindow(1);
    await h.router.routeClick(1, agent);
    h.router.removeWindow(1);
    expect(h.router.rendererReady(1)).toBeNull();
  });
});
