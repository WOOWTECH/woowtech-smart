/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { useAgentTabTooltipActivity } from "./woowtech-agent-tab-tooltip";

// woowtech smart: the "· 5m ago" line under a desktop agent tab's tooltip title. Upstream appends
// an English " ago" to the compact label, which the fork translates, so zh-TW read "5 分 ago".
// English has to read exactly as upstream's tooltip does today.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Halfway through each count, so no label moves on while the test runs.
const AGES = {
  "half a minute": () => new Date(Date.now() - 30 * SECOND_MS),
  "five and a half minutes": () => new Date(Date.now() - 5.5 * MINUTE_MS),
  "two and a half hours": () => new Date(Date.now() - 2.5 * HOUR_MS),
  "three and a half days": () => new Date(Date.now() - 3.5 * DAY_MS),
  "a date past a week": () => new Date("2026-01-15T12:00:00.000Z"),
} as const;

async function tooltipActivity(language: string, date: Date | null): Promise<string> {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
  const { result, unmount } = renderHook(() => useAgentTabTooltipActivity(date));
  const text = result.current;
  unmount();
  return text;
}

describe("desktop agent tab tooltip activity", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  // What upstream's tooltip shows today: its compact label put back into English prose.
  it.each([
    ["half a minute", "just now"],
    ["five and a half minutes", "5m ago"],
    ["two and a half hours", "2h ago"],
    ["three and a half days", "3d ago"],
    ["a date past a week", "Jan 15"],
  ] as const)("reads as today in English: %s gives %j", async (age, expected) => {
    expect(await tooltipActivity("en", AGES[age]())).toBe(expected);
  });

  it.each([
    ["half a minute", "剛剛"],
    ["five and a half minutes", "5 分鐘前"],
    ["two and a half hours", "2 小時前"],
    ["three and a half days", "3 天前"],
    ["a date past a week", "1月15日"],
  ] as const)(
    "reads in Traditional Chinese with no English: %s gives %j",
    async (age, expected) => {
      const text = await tooltipActivity("zh-TW", AGES[age]());
      expect(text).not.toMatch(/ago/i);
      expect(text).toBe(expected);
    },
  );

  it("shows nothing without an activity time", async () => {
    expect(await tooltipActivity("en", null)).toBe("");
    expect(await tooltipActivity("zh-TW", null)).toBe("");
  });

  it("is what the agent tab tooltip shows", () => {
    const source = readFileSync(join(__dirname, "workspace-desktop-tabs-row.tsx"), "utf8");
    expect(source).toContain("const activity = useAgentTabTooltipActivity(lastActivityAt);");
    expect(source).not.toMatch(/formatAgentTooltipActivity|formatCompactTimeAgoAsProse| ago`/);
  });
});
