import { pushLocaleFor, type PushLocale } from "@getpaseo/protocol/woowtech-push";
import type * as ExpoNotifications from "expo-notifications";

// woowtech smart push (fork-owned; woowtech/README.md, 16): the Android notification channels the
// push relay names (functions/smart-payload.js in the relay repo). Both have high importance, so
// Android shows the relay's pushes as heads-up banners. Android never raises the importance of a
// channel that exists, so these replace the app's first channel, "default", which had default
// importance and showed no banner. app.config.js names agent-finished as FCM's default channel.

/** Permission requests, and anything else that needs the user. */
const AGENT_ATTENTION = "agent-attention";
/** Finished work, and the relay's daily limit notice. */
const AGENT_FINISHED = "agent-finished";
const CHANNEL_IDS = [AGENT_ATTENTION, AGENT_FINISHED] as const;

type ChannelId = (typeof CHANNEL_IDS)[number];

export interface WoowtechNotificationChannel {
  id: ChannelId;
  /** What Android's notification settings call the channel. */
  name: string;
}

// In the language the relay writes the pushes in, which follows the app's language.
const CHANNEL_NAMES: Readonly<Record<PushLocale, Readonly<Record<ChannelId, string>>>> = {
  "zh-TW": { [AGENT_ATTENTION]: "需要你處理", [AGENT_FINISHED]: "工作完成" },
  en: { [AGENT_ATTENTION]: "Needs you", [AGENT_FINISHED]: "Work finished" },
};

/** The channels, named for the app's language (i18next), such as "zh-TW" or "en". */
export function woowtechNotificationChannels(appLanguage: string): WoowtechNotificationChannel[] {
  const names = CHANNEL_NAMES[pushLocaleFor(appLanguage)];
  return CHANNEL_IDS.map((id) => ({ id, name: names[id] }));
}

/** The expo-notifications functions that set Android's notification channels. */
export type ExpoNotificationChannels = Pick<
  typeof ExpoNotifications,
  "setNotificationChannelAsync" | "AndroidImportance"
>;

/**
 * Creates each channel, or renames it when it exists. Android keeps the importance of a channel
 * that exists unless the app lowers it, so a channel the user lowered in the system settings stays
 * lowered.
 */
export async function setAndroidNotificationChannels(
  notifications: ExpoNotificationChannels,
  channels: readonly WoowtechNotificationChannel[],
): Promise<void> {
  for (const channel of channels) {
    await notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: notifications.AndroidImportance.HIGH,
    });
  }
}
