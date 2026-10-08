// woowtech smart: tests for woowtech-voice-readiness-copy.ts (woowtech/README.md section 25).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { DaemonServerInfo } from "@/stores/session-store";
import { resolveVoiceUnavailableMessage } from "@/utils/server-info-capabilities";
import {
  KNOWN_VOICE_READINESS_REASONS,
  voiceUnavailableText,
} from "./woowtech-voice-readiness-copy";

const SERVER = join(__dirname, "../../../server/src/server");
const STT_NOT_READY = "Dictation is unavailable: speech-to-text service is not ready.";

function hostSaying(reason: string): DaemonServerInfo {
  return {
    serverId: "srv-1",
    hostname: "test-host",
    version: "0.8.0",
    capabilities: {
      voice: { dictation: { enabled: true, reason }, voice: { enabled: true, reason } },
    },
  };
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("why dictation or voice mode is unavailable", () => {
  it("reads in Traditional Chinese when the app is in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(
      resolveVoiceUnavailableMessage({ serverInfo: hostSaying(STT_NOT_READY), mode: "dictation" }),
    ).toBe("無法使用聽寫：主機的語音轉文字服務還沒準備好。");
    for (const reason of Object.keys(KNOWN_VOICE_READINESS_REASONS)) {
      expect(voiceUnavailableText(reason)).toMatch(/^[^A-Za-z]+$/);
    }
  });

  it("names the models the host is still downloading", async () => {
    await i18n.changeLanguage("zh-TW");
    expect(
      voiceUnavailableText(
        "Voice features are unavailable while models download in the background (parakeet-tdt-0.6b-v3, silero-vad). Try again in a few minutes.",
      ),
    ).toBe(
      "主機正在背景下載語音模型（parakeet-tdt-0.6b-v3, silero-vad），下載完成前無法使用語音功能。請過幾分鐘再試。",
    );
  });

  it("keeps the host's words in English and for sentences it does not know", async () => {
    expect(
      resolveVoiceUnavailableMessage({ serverInfo: hostSaying(STT_NOT_READY), mode: "voice" }),
    ).toBe(STT_NOT_READY);
    await i18n.changeLanguage("zh-TW");
    expect(voiceUnavailableText("Dictation is warming up.")).toBe("Dictation is warming up.");
  });

  it("knows every sentence the daemon sends", () => {
    const runtime = readFileSync(join(SERVER, "speech/speech-runtime.ts"), "utf8");
    const sentences = [
      ...runtime.matchAll(
        /message: "((?:Dictation|Realtime voice) is (?:disabled|unavailable)[^"]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(new Set(sentences)).toEqual(new Set(Object.keys(KNOWN_VOICE_READINESS_REASONS)));
    expect(runtime).toContain(
      "message: `Voice features are unavailable while models download in the background (${joinModelIds(missingModelIds)}).`",
    );
    expect(readFileSync(join(SERVER, "websocket-server.ts"), "utf8")).toContain(
      "return `${baseMessage} Try again in a few minutes.`;",
    );
  });
});
