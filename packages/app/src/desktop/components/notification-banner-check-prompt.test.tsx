/**
 * @vitest-environment jsdom
 */
// woowtech smart: the "Did you see the banner?" prompt under the test notification in Settings
// (notification-banner-check-prompt.tsx, woowtech/README.md section 16).
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askAboutBanner,
  forgetBannerCheckForTest,
  getBannerCheck,
  showBannerHelp,
} from "@/utils/woowtech-notification-banner-check";
import { NotificationBannerCheckPrompt } from "./notification-banner-check-prompt";

const host = vi.hoisted(() => ({
  openSystemSettings: null as null | (() => Promise<boolean>),
}));

vi.mock("@/desktop/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/desktop/host")>();
  return {
    ...actual,
    getDesktopHost: () => ({
      notification: host.openSystemSettings ? { openSystemSettings: host.openSystemSettings } : {},
    }),
  };
});

function ignoreTestAgain(): void {}

describe("the banner question under the test notification", () => {
  beforeAll(async () => {
    if (!testI18n.isInitialized) {
      await testI18n.init();
    }
  });

  beforeEach(() => {
    vi.stubGlobal("React", React);
    host.openSystemSettings = vi.fn(async () => true);
  });

  afterEach(() => {
    cleanup();
    forgetBannerCheckForTest();
    vi.unstubAllGlobals();
  });

  it("shows nothing until a test notification was shown", () => {
    render(<NotificationBannerCheckPrompt onTestAgain={ignoreTestAgain} />);
    expect(screen.queryByText("Did you see the banner?")).toBeNull();
  });

  it("asks once the system showed it, and a yes ends the question", () => {
    render(<NotificationBannerCheckPrompt onTestAgain={ignoreTestAgain} />);
    act(() => askAboutBanner());

    expect(screen.getByText("Did you see the banner?")).toBeTruthy();
    fireEvent.click(screen.getByText("Yes, I saw it"));

    expect(screen.queryByText("Did you see the banner?")).toBeNull();
    expect(getBannerCheck().confirmed).toBe(true);
  });

  it("answers a no with how to turn banners on, a settings button and a new test", () => {
    const onTestAgain = vi.fn();
    render(<NotificationBannerCheckPrompt onTestAgain={onTestAgain} />);
    act(() => askAboutBanner());
    fireEvent.click(screen.getByText("No"));

    expect(screen.getByText("Notifications are not showing")).toBeTruthy();
    fireEvent.click(screen.getByText("Open notification settings"));
    expect(host.openSystemSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Test again"));
    expect(onTestAgain).toHaveBeenCalledTimes(1);
  });

  it("leaves the settings button out where the system has no settings page to open", () => {
    host.openSystemSettings = null;
    render(<NotificationBannerCheckPrompt onTestAgain={ignoreTestAgain} />);
    act(() => showBannerHelp());

    expect(screen.getByText("Notifications are not showing")).toBeTruthy();
    expect(screen.queryByText("Open notification settings")).toBeNull();
    expect(screen.getByText("Test again")).toBeTruthy();
  });
});
