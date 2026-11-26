import { describe, expect, it, vi } from "vitest";
import { createNotificationOpenRouter } from "./model";
import {
  createNativeNotificationOpenSource,
  type NativeNotificationBehavior,
  type NativeNotificationResponse,
  type NativeNotifications,
} from "./native";

class FakeNotifications implements NativeNotifications {
  listeners = new Set<(response: NativeNotificationResponse) => void>();
  launchReads = 0;
  clears = 0;
  handler: { handleNotification: () => Promise<NativeNotificationBehavior> } | null = null;
  constructor(public last: NativeNotificationResponse | null) {}
  setNotificationHandler(handler: NonNullable<FakeNotifications["handler"]>) {
    this.handler = handler;
  }
  addNotificationResponseReceivedListener(
    listener: (response: NativeNotificationResponse) => void,
  ) {
    this.listeners.add(listener);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }
  async getLastNotificationResponseAsync() {
    this.launchReads++;
    return this.last;
  }
  clearLastNotificationResponse() {
    this.clears++;
    this.last = null;
  }
  tap(response: NativeNotificationResponse) {
    this.last = response;
    for (const listener of this.listeners) listener(response);
  }
}

function createResponse(date: number): NativeNotificationResponse {
  return {
    notification: {
      date,
      request: {
        identifier: "agent-collapse-id",
        content: { data: { serverId: "host", workspaceId: "stale", agentId: "agent" } },
      },
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("native notification source", () => {
  it("deduplicates replay across remounts but accepts a new delivery with the same collapse id", async () => {
    const first = createResponse(100);
    const notifications = new FakeNotifications(first);
    const openAgent = vi.fn();
    const router = createNotificationOpenRouter({
      source: createNativeNotificationOpenSource(notifications),
      openAgent,
      openRoute: vi.fn(),
      openTerminal: vi.fn(),
      whenReadyToNavigate: () => Promise.resolve(),
    });
    const stop = router.start();
    notifications.tap(first);
    await flush();
    expect(openAgent).toHaveBeenCalledExactlyOnceWith({ serverId: "host", agentId: "agent" });
    expect(notifications.clears).toBe(1);
    expect(notifications.last).toBeNull();
    stop();
    expect(notifications.listeners.size).toBe(0);

    const stopAgain = router.start();
    notifications.tap(first);
    await flush();
    expect(openAgent).toHaveBeenCalledTimes(1);
    expect(notifications.clears).toBe(1);
    notifications.tap(createResponse(200));
    await flush();
    expect(openAgent).toHaveBeenCalledTimes(2);
    expect(notifications.clears).toBe(2);
    expect(notifications.last).toBeNull();
    expect(notifications.launchReads).toBe(1);
    stopAgain();
  });

  it("leaves the launch response uncleared until navigation becomes ready", async () => {
    const first = createResponse(100);
    const notifications = new FakeNotifications(first);
    let ready = () => {};
    const readiness = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const openAgent = vi.fn();
    const router = createNotificationOpenRouter({
      source: createNativeNotificationOpenSource(notifications),
      openAgent,
      openRoute: vi.fn(),
      openTerminal: vi.fn(),
      whenReadyToNavigate: () => readiness,
    });
    const stop = router.start();
    await flush();
    expect(openAgent).not.toHaveBeenCalled();
    expect(notifications.clears).toBe(0);
    expect(notifications.last).toBe(first);
    ready();
    await flush();
    expect(openAgent).toHaveBeenCalledTimes(1);
    expect(notifications.clears).toBe(1);
    expect(notifications.last).toBeNull();
    stop();
  });

  it("keeps foreground notifications in the system list without a duplicate banner or sound", async () => {
    const notifications = new FakeNotifications(null);
    createNativeNotificationOpenSource(notifications);
    if (!notifications.handler) throw new Error("Notification handler was not installed");
    await expect(notifications.handler.handleNotification()).resolves.toEqual({
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});
