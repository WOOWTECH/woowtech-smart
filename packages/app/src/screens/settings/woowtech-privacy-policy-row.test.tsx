/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { i18n } from "@/i18n/i18next";
import { openExternalUrl } from "@/utils/open-external-url";
import { WoowtechPrivacyPolicyRow } from "./woowtech-privacy-policy-row";

// woowtech smart: Settings > About's privacy policy row (woowtech/README.md §10) opens the policy
// on the website, labelled in the app's language.

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: vi.fn(),
}));

describe("the privacy policy row in Settings > About", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.mocked(openExternalUrl).mockClear();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await i18n.changeLanguage("en");
  });

  it("opens the privacy policy on the website", async () => {
    await i18n.changeLanguage("zh-TW");
    render(<WoowtechPrivacyPolicyRow />);
    expect(screen.getByText("隱私權政策")).toBeTruthy();
    expect(screen.getByText("App 處理哪些資料、送到哪裡")).toBeTruthy();

    fireEvent.click(screen.getByText("隱私權政策"));

    expect(openExternalUrl).toHaveBeenCalledWith(BRAND_LINKS.privacyPolicy);
    expect(BRAND_LINKS.privacyPolicy).toMatch(
      /^https:\/\/aiot\.woowtech\.io\/blog\/help-center-7\//,
    );
  });

  it("reads in English when the app is in English", async () => {
    await i18n.changeLanguage("en");
    render(<WoowtechPrivacyPolicyRow />);
    expect(screen.getByText("Privacy policy")).toBeTruthy();
    expect(screen.getByText("What data the app handles and where it goes")).toBeTruthy();
  });
});
