// woowtech smart: tests for woowtech-notification-banner-check.ts (woowtech/README.md section 16).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAsyncStorageStub } from "../../test-stubs/async-storage";
import {
  answerBannerSeen,
  forgetBannerCheckForTest,
  getBannerCheck,
  loadBannerCheck,
  sendBannerCheckNotification,
  showBannerHelp,
  subscribeToBannerCheck,
} from "./woowtech-notification-banner-check";

const CONFIRMED_KEY = "@woowtech:notification-banner-confirmed";

afterEach(() => {
  forgetBannerCheckForTest();
  clearAsyncStorageStub();
  vi.restoreAllMocks();
});

describe("the saved answer", () => {
  it("is not there on a computer that was never asked", async () => {
    expect(getBannerCheck()).toEqual({ loaded: false, confirmed: false, phase: "idle" });
    await loadBannerCheck();
    expect(getBannerCheck()).toEqual({ loaded: true, confirmed: false, phase: "idle" });
  });

  it("is read back after the person saw the banner", async () => {
    await AsyncStorage.setItem(CONFIRMED_KEY, "1");
    await loadBannerCheck();
    expect(getBannerCheck().confirmed).toBe(true);
  });

  it("is read once", async () => {
    const read = vi.spyOn(AsyncStorage, "getItem");
    await Promise.all([loadBannerCheck(), loadBannerCheck()]);
    await loadBannerCheck();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("counts as no answer when the storage cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("storage is gone"));
    await loadBannerCheck();
    expect(getBannerCheck()).toEqual({ loaded: true, confirmed: false, phase: "idle" });
  });
});

describe("the question after a test notification", () => {
  it("is asked when the system showed the notification", async () => {
    await sendBannerCheckNotification(async () => "shown");
    expect(getBannerCheck().phase).toBe("asking");
  });

  it("is skipped for the help when the system could not show it", async () => {
    for (const result of ["failed", "unconfirmed"] as const) {
      forgetBannerCheckForTest();
      await sendBannerCheckNotification(async () => result);
      expect(getBannerCheck().phase).toBe("help");
    }
  });

  it("is skipped for the help when sending throws", async () => {
    await sendBannerCheckNotification(async () => {
      throw new Error("bridge is gone");
    });
    expect(getBannerCheck().phase).toBe("help");
  });

  it("ends with a yes that is kept on this computer", async () => {
    await sendBannerCheckNotification(async () => "shown");
    answerBannerSeen();
    expect(getBannerCheck()).toMatchObject({ confirmed: true, phase: "idle" });
    await vi.waitFor(async () => expect(await AsyncStorage.getItem(CONFIRMED_KEY)).toBe("1"));
  });

  it("ends with a no that shows the help", async () => {
    await sendBannerCheckNotification(async () => "shown");
    showBannerHelp();
    expect(getBannerCheck()).toMatchObject({ confirmed: false, phase: "help" });
  });
});

describe("listeners", () => {
  it("hear every change and nothing else", () => {
    const heard = vi.fn();
    subscribeToBannerCheck(heard);
    showBannerHelp();
    showBannerHelp();
    expect(heard).toHaveBeenCalledTimes(1);
    answerBannerSeen();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("stop hearing after unsubscribing", () => {
    const heard = vi.fn();
    const unsubscribe = subscribeToBannerCheck(heard);
    unsubscribe();
    showBannerHelp();
    expect(heard).not.toHaveBeenCalled();
  });
});
