import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetHandledNotificationTapsForTest,
  subscribeToNotificationTaps,
  type NotificationResponseLike,
  type NotificationResponseSource,
} from "./woowtech-notification-response";

// Each delivery gets its own date, as UNNotification.date and the FCM sent time do.
let deliveryClock = 1_700_000_000;

function tapResponse(
  identifier: string,
  data: Record<string, unknown> | null = { agentId: identifier },
  date: number = (deliveryClock += 1),
): NotificationResponseLike {
  return { notification: { date, request: { identifier, content: { data } } } };
}

interface EmitterOptions {
  /** The F-Droid stub (fdroid/expo-notifications.ts) has nothing to clear. */
  clears: boolean;
}

// expo-notifications' emitter module: the last tap stays readable until cleared
// (EmitterModule.swift on iOS, NotificationsEmitter.kt on Android).
function createEmitter(
  launchTap: NotificationResponseLike | null,
  options: EmitterOptions = { clears: true },
) {
  let last = launchTap;
  const listeners = new Set<(response: NotificationResponseLike) => void>();
  const source: NotificationResponseSource = {
    getLastNotificationResponse: () => last,
    clearLastNotificationResponse: () => {
      if (options.clears) {
        last = null;
      }
    },
    addNotificationResponseReceivedListener: (listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    source,
    tap(response: NotificationResponseLike) {
      last = response;
      for (const listener of listeners) {
        listener(response);
      }
    },
    last: () => last,
  };
}

// subscribeToNotificationTaps hands the launch tap over one microtask after subscribing, once the
// commit that mounted the router has run its effects; this resolves after that microtask.
function afterHandOver(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function recordOpens() {
  const opened: (Record<string, unknown> | undefined)[] = [];
  return { opened, open: (data: Record<string, unknown> | undefined) => opened.push(data) };
}

beforeEach(() => {
  forgetHandledNotificationTapsForTest();
});

describe("notification taps reach the router once per app process (RC-I-21c)", () => {
  it("routes the tap that launched the app", async () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  // Inside the effect, the bridge flushed the intent before the root stack reached the container's
  // state and the navigation never happened (Android cold start, README section 16).
  it("hands the launch tap over after the commit that mounted the router, not inside it", async () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);
    const duringCommit = [...opened];
    await afterHandOver();

    expect(duringCommit).toEqual([]);
    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("leaves the launch tap to the next mount when the router unmounts before the hand-over", async () => {
    const launchTap = tapResponse("launch");
    const emitter = createEmitter(launchTap);
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open)();
    await afterHandOver();
    const afterFirstMount = [...opened];
    const nativeCopy = emitter.last();
    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    expect(afterFirstMount).toEqual([]);
    expect(nativeCopy).toBe(launchTap);
    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("routes it once when the listener also delivers it", async () => {
    const launchTap = tapResponse("launch");
    const emitter = createEmitter(launchTap);
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);
    emitter.tap(launchTap);
    await afterHandOver();

    expect(opened).toHaveLength(1);
  });

  it("clears the native copy once it has routed it", async () => {
    const emitter = createEmitter(tapResponse("launch"));

    subscribeToNotificationTaps(emitter.source, () => undefined);
    await afterHandOver();

    expect(emitter.last()).toBeNull();
  });

  it("does not replay the launch tap when the router mounts again", async () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();

    const unsubscribe = subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();
    unsubscribe();
    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("does not replay it either where the stub cannot clear it (F-Droid)", async () => {
    const emitter = createEmitter(tapResponse("launch"), { clears: false });
    const { opened, open } = recordOpens();

    const unsubscribe = subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();
    unsubscribe();
    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("routes a later tap after a remount", async () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();
    const unsubscribe = subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();
    unsubscribe();
    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    emitter.tap(tapResponse("second"));

    expect(opened).toEqual([{ agentId: "launch" }, { agentId: "second" }]);
  });

  // The relay sets apns-collapse-id to the agent id and iOS uses it as the request identifier, so
  // every notification for one agent arrives with the same identifier.
  it("routes a new notification for an agent already tapped", async () => {
    const emitter = createEmitter(tapResponse("agent-b", { agentId: "B" }));
    const { opened, open } = recordOpens();
    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    emitter.tap(tapResponse("agent-b", { agentId: "B" }));

    expect(opened).toEqual([{ agentId: "B" }, { agentId: "B" }]);
  });

  it("routes B, C and then B again", () => {
    const emitter = createEmitter(null);
    const { opened, open } = recordOpens();
    subscribeToNotificationTaps(emitter.source, open);

    emitter.tap(tapResponse("agent-b", { agentId: "B" }));
    emitter.tap(tapResponse("agent-c", { agentId: "C" }));
    emitter.tap(tapResponse("agent-b", { agentId: "B" }));

    expect(opened).toEqual([{ agentId: "B" }, { agentId: "C" }, { agentId: "B" }]);
  });

  it("routes a new notification for the launch agent after a remount", async () => {
    const emitter = createEmitter(tapResponse("agent-b", { agentId: "B" }), { clears: false });
    const { opened, open } = recordOpens();
    const unsubscribe = subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();
    unsubscribe();
    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    emitter.tap(tapResponse("agent-b", { agentId: "B" }));

    expect(opened).toEqual([{ agentId: "B" }, { agentId: "B" }]);
  });

  it("stops listening when unsubscribed", () => {
    const emitter = createEmitter(null);
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open)();
    emitter.tap(tapResponse("after"));

    expect(opened).toEqual([]);
  });

  it("hands over no data when the tap carries none", async () => {
    // iOS reads a remote push's data from userInfo["body"] only (EXNotificationSerializer.m:79-83).
    const emitter = createEmitter(tapResponse("bodiless", null));
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);
    await afterHandOver();

    expect(opened).toEqual([undefined]);
  });
});
