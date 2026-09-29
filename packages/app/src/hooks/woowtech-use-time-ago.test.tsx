/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { useCompactTimeAgo, useTimeAgo } from "./use-time-ago";

// woowtech smart: the relative labels are translated (woowtech.time, README section 14), and
// useTimeAgo keeps its label in state between ticks. A language change has to re-word the label
// right away: a minute label would stay in the old language until the next tick, and a date label
// never ticks again.

const MINUTE_MS = 60_000;

describe("relative time labels follow the app language", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("re-words a prose label when the language changes", async () => {
    // Five and a half minutes, so the label cannot age into "6m" while the test runs.
    const date = new Date(Date.now() - 5.5 * MINUTE_MS);
    const { result } = renderHook(() => useTimeAgo(date));
    expect(result.current).toBe("5m ago");

    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
    expect(result.current).toBe("5 分鐘前");
  });

  it("re-words a date label, which no tick will ever update", async () => {
    const date = new Date("2026-01-15T12:00:00.000Z");
    const { result } = renderHook(() => useTimeAgo(date));
    expect(result.current).toBe("Jan 15");

    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
    expect(result.current).toBe("1月15日");
  });

  it("re-words a compact label when the language changes", async () => {
    const date = new Date(Date.now() - 5.5 * MINUTE_MS);
    const { result } = renderHook(() => useCompactTimeAgo(date));
    expect(result.current).toBe("5m");

    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
    expect(result.current).toBe("5 分");
  });
});
