import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetHandledNotificationTapsForTest,
  subscribeToNotificationTaps,
  type NotificationResponseLike,
  type NotificationResponseSource,
} from "./woowtech-notification-response";

function tapResponse(
  identifier: string,
  data: Record<string, unknown> | null = { agentId: identifier },
): NotificationResponseLike {
  return { notification: { request: { identifier, content: { data } } } };
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

function recordOpens() {
  const opened: (Record<string, unknown> | undefined)[] = [];
  return { opened, open: (data: Record<string, unknown> | undefined) => opened.push(data) };
}

beforeEach(() => {
  forgetHandledNotificationTapsForTest();
});

describe("notification taps reach the router once per app process (RC-I-21c)", () => {
  it("routes the tap that launched the app", () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);

    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("routes it once when the listener also delivers it", () => {
    const launchTap = tapResponse("launch");
    const emitter = createEmitter(launchTap);
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);
    emitter.tap(launchTap);

    expect(opened).toHaveLength(1);
  });

  it("clears the native copy once it has routed it", () => {
    const emitter = createEmitter(tapResponse("launch"));

    subscribeToNotificationTaps(emitter.source, () => undefined);

    expect(emitter.last()).toBeNull();
  });

  it("does not replay the launch tap when the router mounts again", () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();

    const unsubscribe = subscribeToNotificationTaps(emitter.source, open);
    unsubscribe();
    subscribeToNotificationTaps(emitter.source, open);

    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("does not replay it either where the stub cannot clear it (F-Droid)", () => {
    const emitter = createEmitter(tapResponse("launch"), { clears: false });
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open)();
    subscribeToNotificationTaps(emitter.source, open);

    expect(opened).toEqual([{ agentId: "launch" }]);
  });

  it("routes a later tap after a remount", () => {
    const emitter = createEmitter(tapResponse("launch"));
    const { opened, open } = recordOpens();
    subscribeToNotificationTaps(emitter.source, open)();
    subscribeToNotificationTaps(emitter.source, open);

    emitter.tap(tapResponse("second"));

    expect(opened).toEqual([{ agentId: "launch" }, { agentId: "second" }]);
  });

  it("stops listening when unsubscribed", () => {
    const emitter = createEmitter(null);
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open)();
    emitter.tap(tapResponse("after"));

    expect(opened).toEqual([]);
  });

  it("hands over no data when the tap carries none", () => {
    // iOS reads a remote push's data from userInfo["body"] only (EXNotificationSerializer.m:79-83).
    const emitter = createEmitter(tapResponse("bodiless", null));
    const { opened, open } = recordOpens();

    subscribeToNotificationTaps(emitter.source, open);

    expect(opened).toEqual([undefined]);
  });
});
