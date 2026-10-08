// woowtech smart: a turn's timestamp reads in the app language, not the system's (utils/time.ts
// getTimeFormatter, formatMessageTimestamp; woowtech/README.md section 25).
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatMessageTimestamp } from "./time";

// 2026-05-14 is a Thursday. 2026-05-11 is a Monday.
const now = new Date(2026, 4, 14, 17, 30);

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("a turn's timestamp", () => {
  it("names the weekday and the date in Traditional Chinese when the app is in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(formatMessageTimestamp(new Date(2026, 4, 11, 22, 12), now)).toMatch(/^星期一 .*10:12/);
    expect(formatMessageTimestamp(new Date(2026, 3, 1, 9, 5), now)).toMatch(/^2026年4月1日/);
  });

  it("reads in the locale it is given, so a memoized label can follow a language change", () => {
    const monday = new Date(2026, 4, 11, 22, 12);
    expect(formatMessageTimestamp(monday, now, "zh-TW")).toMatch(/^星期一 /);
    expect(formatMessageTimestamp(monday, now, "en-US")).toMatch(/^Monday /);
  });

  it("follows the app language when it changes", async () => {
    const monday = new Date(2026, 4, 11, 22, 12);
    await i18n.changeLanguage("zh-TW");
    expect(formatMessageTimestamp(monday, now)).toMatch(/星期一/);
    await i18n.changeLanguage("en");
    expect(formatMessageTimestamp(monday, now)).toMatch(/^Monday /);
  });
});
