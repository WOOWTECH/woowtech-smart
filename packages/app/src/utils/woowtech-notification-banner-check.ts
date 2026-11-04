// woowtech smart (woowtech/README.md section 16): the system tells the app a notification was
// "shown" even when it put it away without a banner (notifications off, alert style None, Focus),
// and the app cannot tell the difference. Only the person at the computer can, so the app asks:
// it sends a test notification, then "Did you see the banner?". Yes is remembered on this device;
// no shows how to turn banners on in the system's settings.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NotificationDeliveryResult } from "@/desktop/host";

/**
 * - `idle`: nothing is being asked.
 * - `asking`: a test notification was shown, and the person has not said whether they saw it.
 * - `help`: they did not see it, or the system said it could not show it.
 */
export type BannerCheckPhase = "idle" | "asking" | "help";

export interface BannerCheckState {
  /** The saved answer has been read, so the first-run callout never flashes for a yes. */
  loaded: boolean;
  /** The person said they saw the banner. Kept on this device. */
  confirmed: boolean;
  phase: BannerCheckPhase;
}

const CONFIRMED_STORAGE_KEY = "@woowtech:notification-banner-confirmed";

const INITIAL_STATE: BannerCheckState = { loaded: false, confirmed: false, phase: "idle" };

let state: BannerCheckState = INITIAL_STATE;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function subscribeToBannerCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A new object on every change, so it can be a useSyncExternalStore snapshot. */
export function getBannerCheck(): BannerCheckState {
  return state;
}

function update(patch: Partial<BannerCheckState>): void {
  const next = { ...state, ...patch };
  const unchanged =
    next.loaded === state.loaded &&
    next.confirmed === state.confirmed &&
    next.phase === state.phase;
  if (unchanged) {
    return;
  }
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Reads the saved answer once. A storage that cannot be read counts as no answer yet. */
export function loadBannerCheck(): Promise<void> {
  if (state.loaded) {
    return Promise.resolve();
  }
  loading ??= AsyncStorage.getItem(CONFIRMED_STORAGE_KEY)
    .then((value) => update({ loaded: true, confirmed: value === "1" }))
    .catch((error) => {
      console.warn("[Notifications] Could not read whether the banner was seen", error);
      update({ loaded: true });
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The system showed the test notification: ask whether the person saw it. */
export function askAboutBanner(): void {
  update({ phase: "asking" });
}

/** The person saw the banner: remember it, and stop asking. */
export function answerBannerSeen(): void {
  update({ confirmed: true, phase: "idle" });
  AsyncStorage.setItem(CONFIRMED_STORAGE_KEY, "1").catch((error) => {
    console.warn("[Notifications] Could not remember that the banner was seen", error);
  });
}

/**
 * The person did not see the banner, or the system could not show the test notification. Either
 * way banners do not show now, so an earlier yes no longer holds.
 */
export function showBannerHelp(): void {
  update({ confirmed: false, phase: "help" });
  AsyncStorage.removeItem(CONFIRMED_STORAGE_KEY).catch((error) => {
    console.warn("[Notifications] Could not forget that the banner was seen", error);
  });
}

/**
 * Sends the test notification and moves on: to the question when the system showed it, to the
 * help when it said it could not.
 */
export async function sendBannerCheckNotification(
  send: () => Promise<NotificationDeliveryResult>,
): Promise<void> {
  let result: NotificationDeliveryResult;
  try {
    result = await send();
  } catch {
    result = "failed";
  }
  if (result === "shown") {
    askAboutBanner();
  } else {
    showBannerHelp();
  }
}

/** Test seam: the answer is process state on purpose. */
export function forgetBannerCheckForTest(): void {
  state = INITIAL_STATE;
  loading = null;
  listeners.clear();
}
