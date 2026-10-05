import { describe, expect, it } from "vitest";
import {
  setAndroidNotificationChannels,
  woowtechNotificationChannels,
  type ExpoNotificationChannels,
} from "./woowtech-notification-channels";

// expo-notifications' AndroidImportance (0.32), which the unit tests cannot import.
const AndroidImportance = {
  DEFAULT: 5,
  HIGH: 6,
} as ExpoNotificationChannels["AndroidImportance"];

type ChannelInput = Parameters<ExpoNotificationChannels["setNotificationChannelAsync"]>[1];

// A typed in-memory stand-in for the expo-notifications functions that set channels.
function fakeExpoNotifications() {
  const calls: [string, ChannelInput][] = [];
  const notifications: ExpoNotificationChannels = {
    AndroidImportance,
    setNotificationChannelAsync: async (channelId, channel) => {
      calls.push([channelId, channel]);
      return null;
    },
  };
  return { notifications, calls };
}

describe("woowtech smart's Android notification channels", () => {
  it("are the two channels the relay names, in Traditional Chinese for every Chinese language", () => {
    for (const language of ["zh-TW", "zh-CN", "zh-Hant", "zh"]) {
      expect(woowtechNotificationChannels(language)).toEqual([
        { id: "agent-attention", name: "需要你處理" },
        { id: "agent-finished", name: "工作完成" },
      ]);
    }
  });

  it("are named in English for every other language, as the relay writes the pushes", () => {
    for (const language of ["en", "ja", "ko", "fr"]) {
      expect(woowtechNotificationChannels(language)).toEqual([
        { id: "agent-attention", name: "Needs you" },
        { id: "agent-finished", name: "Work finished" },
      ]);
    }
  });

  it("are set through expo-notifications with high importance, which shows heads-up banners", async () => {
    const { notifications, calls } = fakeExpoNotifications();

    await setAndroidNotificationChannels(notifications, woowtechNotificationChannels("zh-TW"));

    expect(calls).toEqual([
      ["agent-attention", { name: "需要你處理", importance: AndroidImportance.HIGH }],
      ["agent-finished", { name: "工作完成", importance: AndroidImportance.HIGH }],
    ]);
  });
});
