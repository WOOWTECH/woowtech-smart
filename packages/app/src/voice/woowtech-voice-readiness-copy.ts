import { i18n } from "@/i18n/i18next";

// woowtech smart (woowtech/README.md section 25): the daemon says why dictation or voice mode is
// unavailable in English (packages/server/src/server/speech/speech-runtime.ts), and the host info
// carries only those words, not the reason code. The sentences this app knows pick the text in the
// app language. Languages without their own text, and sentences this app does not know, keep the
// daemon's words.

/** The daemon's sentences and the woowtech.voiceReadiness key each one reads as. */
export const KNOWN_VOICE_READINESS_REASONS: Readonly<Record<string, string>> = {
  "Dictation is disabled in daemon config.": "dictationDisabled",
  "Dictation is unavailable: speech-to-text service is not ready.": "dictationSttUnavailable",
  "Realtime voice is disabled in daemon config.": "voiceDisabled",
  "Realtime voice is unavailable: turn-detection service is not ready.":
    "voiceTurnDetectionUnavailable",
  "Realtime voice is unavailable: speech-to-text service is not ready.": "voiceSttUnavailable",
  "Realtime voice is unavailable: text-to-speech service is not ready.": "voiceTtsUnavailable",
};

// The daemon names the models it is downloading, and websocket-server.ts resolveCapabilityReason
// adds the last sentence.
const MODELS_DOWNLOADING =
  /^Voice features are unavailable while models download in the background \((.+)\)\.(?: Try again in a few minutes\.)?$/;

export function voiceUnavailableText(reason: string): string {
  const downloading = MODELS_DOWNLOADING.exec(reason);
  const key = downloading ? "modelsDownloading" : KNOWN_VOICE_READINESS_REASONS[reason];
  if (!key) {
    return reason;
  }
  const values = downloading ? { models: downloading[1] } : {};
  const fullKey = `woowtech.voiceReadiness.${key}`;
  const translated = i18n.t(fullKey, values);
  return translated === i18n.t(fullKey, { ...values, lng: "en" }) ? reason : translated;
}
