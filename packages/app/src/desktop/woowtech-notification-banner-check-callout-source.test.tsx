/**
 * @vitest-environment jsdom
 */
// woowtech smart: the first-run "Did you see the banner?" callout in the desktop sidebar
// (woowtech-notification-banner-check-callout-source.tsx, woowtech/README.md section 16).
import { i18n as testI18n } from "@/i18n/i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAsyncStorageStub } from "../../test-stubs/async-storage";
import { SidebarCalloutProvider, SidebarCalloutViewport } from "@/contexts/sidebar-callout-context";
import {
  forgetBannerCheckForTest,
  getBannerCheck,
  loadBannerCheck,
} from "@/utils/woowtech-notification-banner-check";
import { NotificationBannerCheckCalloutSource } from "./woowtech-notification-banner-check-callout-source";

type DeliveryResult = "shown" | "failed" | "unconfirmed";

const host = vi.hoisted(() => ({
  electron: true,
  result: "shown" as "shown" | "failed" | "unconfirmed",
  sent: [] as unknown[],
  openSystemSettings: vi.fn(async () => true),
}));

vi.mock("@/constants/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/constants/platform")>();
  return { ...actual, getIsElectron: () => host.electron };
});

vi.mock("@/desktop/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/desktop/host")>();
  return {
    ...actual,
    getDesktopHost: () =>
      host.electron
        ? {
            notification: {
              sendNotificationWithResult: async (payload: unknown): Promise<DeliveryResult> => {
                host.sent.push(payload);
                return host.result;
              },
              openSystemSettings: host.openSystemSettings,
            },
          }
        : null,
  };
});

function renderSidebar() {
  return render(
    <SidebarCalloutProvider>
      <NotificationBannerCheckCalloutSource />
      <SidebarCalloutViewport />
    </SidebarCalloutProvider>,
  );
}

describe("the first-run banner check in the desktop sidebar", () => {
  beforeAll(async () => {
    if (!testI18n.isInitialized) {
      await testI18n.init();
    }
  });

  beforeEach(() => {
    vi.stubGlobal("React", React);
    host.electron = true;
    host.result = "shown";
    host.sent = [];
    host.openSystemSettings.mockClear();
  });

  afterEach(() => {
    cleanup();
    forgetBannerCheckForTest();
    clearAsyncStorageStub();
    vi.unstubAllGlobals();
  });

  it("offers a test notification, asks about the banner, and is gone after a yes", async () => {
    renderSidebar();
    fireEvent.click(await screen.findByText("Send test notification"));

    expect(host.sent).toHaveLength(1);
    fireEvent.click(await screen.findByText("Yes, I saw it"));

    expect(screen.queryByText("Did you see the banner?")).toBeNull();
    expect(screen.queryByText("Check that notifications show up")).toBeNull();
    expect(getBannerCheck().confirmed).toBe(true);
  });

  it("shows how to turn banners on after a no", async () => {
    renderSidebar();
    fireEvent.click(await screen.findByText("Send test notification"));
    fireEvent.click(await screen.findByText("No"));

    expect(await screen.findByText("Notifications are not showing")).toBeTruthy();
    fireEvent.click(screen.getByText("Open notification settings"));
    expect(host.openSystemSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Test again"));
    await vi.waitFor(() => expect(host.sent).toHaveLength(2));
  });

  it("goes straight to the help when the system could not show the test", async () => {
    host.result = "failed";
    renderSidebar();
    fireEvent.click(await screen.findByText("Send test notification"));

    expect(await screen.findByText("Notifications are not showing")).toBeTruthy();
    expect(screen.queryByText("Did you see the banner?")).toBeNull();
  });

  it("is not shown again on a computer where the person saw the banner", async () => {
    await AsyncStorage.setItem("@woowtech:notification-banner-confirmed", "1");
    renderSidebar();
    await act(async () => {
      await loadBannerCheck();
    });
    expect(getBannerCheck().loaded).toBe(true);
    expect(screen.queryByText("Check that notifications show up")).toBeNull();
  });

  it("is not shown outside the desktop app", async () => {
    host.electron = false;
    renderSidebar();
    await act(async () => {});
    expect(screen.queryByText("Check that notifications show up")).toBeNull();
  });
});
