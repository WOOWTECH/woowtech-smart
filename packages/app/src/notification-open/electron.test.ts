import { describe, expect, it, vi } from "vitest";
import type { DesktopEventsBridge, DesktopHostBridge } from "@/desktop/host";
import { createElectronNotificationOpenSource } from "./electron";
import type { NotificationOpenSource, NotificationTap } from "./source";

class FakeWebSource implements NotificationOpenSource {
  listeners = new Set<(tap: NotificationTap) => void>();
  acknowledged: NotificationTap[] = [];
  subscribe(listener: (tap: NotificationTap) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async takeLaunchTap() {
    return null;
  }
  acknowledge(tap: NotificationTap) {
    this.acknowledged.push(tap);
  }
  tap(tap: NotificationTap) {
    for (const listener of this.listeners) listener(tap);
  }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setup(host: DesktopHostBridge | null) {
  const web = new FakeWebSource();
  const source = createElectronNotificationOpenSource({ getHost: () => host, web });
  return { source, web };
}

function setupPendingRead() {
  const pending = { data: { serverId: "host", agentId: "launch" } };
  let deliver: (click: typeof pending) => void = () => {};
  const read = new Promise<typeof pending>((resolve) => {
    deliver = resolve;
  });
  const takePendingClick = vi
    .fn<() => Promise<typeof pending | null>>()
    .mockReturnValueOnce(read)
    .mockResolvedValue(null);
  const stopDesktop = vi.fn();
  const { source } = setup({
    events: { on: () => stopDesktop },
    notification: { takePendingClick },
  });
  return { source, pending, deliver, takePendingClick, stopDesktop };
}

describe("desktop notification source", () => {
  it("installs the listener before consuming the click that reopened the window", async () => {
    let installed: (stop: () => void) => void = () => {};
    const registration = new Promise<() => void>((resolve) => {
      installed = resolve;
    });
    let desktopClick: (payload: unknown) => void = () => {};
    const on = vi.fn<NonNullable<DesktopEventsBridge["on"]>>((event, handler) => {
      expect(event).toBe("notification-click");
      desktopClick = handler;
      return registration;
    });
    const pending = { serverId: "host", agentId: "launch" };
    const takePendingClick = vi.fn(async () => ({ data: pending }));
    const { source, web } = setup({ events: { on }, notification: { takePendingClick } });
    const onTap = vi.fn();
    const stop = source.subscribe(onTap);
    await flush();
    expect(takePendingClick).not.toHaveBeenCalled();

    const stopDesktop = vi.fn();
    installed(stopDesktop);
    await flush();
    expect(takePendingClick).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledExactlyOnceWith({ id: "electron:1", data: pending });
    desktopClick({ data: { serverId: "host", agentId: "live" } });
    expect(onTap).toHaveBeenLastCalledWith({
      id: "electron:2",
      data: { serverId: "host", agentId: "live" },
    });
    const browserTap = { id: "web:1", data: { serverId: "host", agentId: "browser" } };
    web.tap(browserTap);
    expect(onTap).toHaveBeenLastCalledWith(browserTap);
    stop();
    expect(stopDesktop).toHaveBeenCalledTimes(1);
    expect(web.listeners.size).toBe(0);
    desktopClick({ data: pending });
    web.tap(browserTap);
    expect(onTap).toHaveBeenCalledTimes(3);
  });

  it("does not consume the native pending click if unmounted before listener registration", async () => {
    let installed: (stop: () => void) => void = () => {};
    const registration = new Promise<() => void>((resolve) => {
      installed = resolve;
    });
    const takePendingClick = vi.fn(async () => null);
    const { source } = setup({
      events: { on: () => registration },
      notification: { takePendingClick },
    });
    const onTap = vi.fn();
    const stopDesktop = vi.fn();
    source.subscribe(onTap)();
    installed(stopDesktop);
    await flush();
    expect(stopDesktop).toHaveBeenCalledTimes(1);
    expect(takePendingClick).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("buffers a consumed click that arrives while unmounted", async () => {
    const { source, pending, deliver, takePendingClick, stopDesktop } = setupPendingRead();
    const first = vi.fn();
    const stop = source.subscribe(first);
    await flush();
    expect(takePendingClick).toHaveBeenCalledTimes(1);
    stop();
    deliver(pending);
    await flush();
    expect(first).not.toHaveBeenCalled();
    const second = vi.fn();
    const stopAgain = source.subscribe(second);
    await flush();
    expect(second).toHaveBeenCalledExactlyOnceWith({ id: "electron:1", data: pending.data });
    expect(stopDesktop).toHaveBeenCalledTimes(1);
    stopAgain();
  });

  it("hands a consumed click directly to the new mount when its read completes late", async () => {
    const { source, pending, deliver, takePendingClick, stopDesktop } = setupPendingRead();
    const first = vi.fn();
    const stop = source.subscribe(first);
    await flush();
    expect(takePendingClick).toHaveBeenCalledTimes(1);
    stop();
    const second = vi.fn();
    const stopAgain = source.subscribe(second);
    deliver(pending);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith({ id: "electron:1", data: pending.data });
    expect(stopDesktop).toHaveBeenCalledTimes(1);
    stopAgain();
  });

  it("keeps the web source working without a desktop bridge", async () => {
    const { source, web } = setup(null);
    const onTap = vi.fn();
    const stop = source.subscribe(onTap);
    await expect(source.takeLaunchTap()).resolves.toBeNull();
    const tap = { id: "web:1", data: { serverId: "host" } };
    web.tap(tap);
    expect(onTap).toHaveBeenCalledExactlyOnceWith(tap);
    source.acknowledge(tap);
    expect(web.acknowledged).toEqual([tap]);
    stop();
    expect(web.listeners.size).toBe(0);
  });
});
