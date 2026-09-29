import { ClaudeAgentSdkDownloadError } from "../../../server/src/server/agent/providers/claude/claude-agent-sdk-download";
import { ClaudeAgentSdkIntegrityError } from "../../../server/src/server/agent/providers/claude/claude-agent-sdk-runtime";
import { ClaudeAgentSdkRuntimeError } from "../../../server/src/server/agent/providers/claude/claude-agent-sdk-installation";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import { expect, test } from "vitest";
import { claudeSdkErrorTranslationKey, claudeSdkSystemErrorMessage } from "./claude-sdk-error";
import { woowtechCopyFor } from "../i18n/woowtech-copy";
import { i18n } from "@/i18n/i18next";
import { reduceStreamUpdate } from "@/types/stream";

const download =
  "[woowtech:claude-sdk:download] Claude Agent SDK download failed with HTTP 503. First use of Claude requires downloading a component, but the registry or mirror could not be reached. Send your next message to retry.";
test("maps only the complete fork SDK error contract to English and Traditional Chinese", () => {
  expect(claudeSdkErrorTranslationKey("error", download)).toBe("woowtech.claudeSdk.download");
  expect(woowtechCopyFor("zh-TW").claudeSdk.download).toBe(
    "首次使用 Claude 需要下載元件，但目前無法連線到 registry 或鏡像站。傳送下一則訊息時會自動重試。",
  );
  expect(woowtechCopyFor("en").claudeSdk.download).toBe(
    "First use of Claude requires downloading a component, but the registry or mirror could not be reached. Send your next message to retry.",
  );
});
test("does not translate ordinary messages, partial markers or unknown error details", () => {
  for (const level of ["info", "warning"])
    expect(claudeSdkErrorTranslationKey(level, download)).toBeNull();
  for (const message of [
    `${download}\n`,
    "ordinary Agent output",
    "network error",
    "[woowtech:claude-sdk:download]",
    `${download} fixture-private-detail`,
    `Agent says: ${download}`,
    download.replace("503", "fixture-secret"),
  ]) {
    expect(claudeSdkErrorTranslationKey("error", message)).toBeNull();
  }
});

test("server error constructors match all three UI classifications without exposing technical inputs", () => {
  for (const status of [undefined, 503])
    expect(
      claudeSdkErrorTranslationKey("error", new ClaudeAgentSdkDownloadError(status).message),
    ).toBe("woowtech.claudeSdk.download");
  const integrity = new ClaudeAgentSdkIntegrityError("fixture expected", "fixture actual");
  expect(claudeSdkErrorTranslationKey("error", integrity.message)).toBe(
    "woowtech.claudeSdk.integrity",
  );
  expect(integrity.message).not.toContain("fixture");
  expect(claudeSdkErrorTranslationKey("error", new ClaudeAgentSdkRuntimeError().message)).toBe(
    "woowtech.claudeSdk.runtime",
  );
  expect(woowtechCopyFor("zh-TW").claudeSdk).toEqual({
    download:
      "首次使用 Claude 需要下載元件，但目前無法連線到 registry 或鏡像站。傳送下一則訊息時會自動重試。",
    integrity: "下載的 Claude 元件未通過完整性檢查，因此沒有安裝。傳送下一則訊息時會自動重試。",
    runtime: "無法安裝或載入 Claude 元件。傳送下一則訊息時會自動重試。",
  });
});

// The daemon reports a failed turn as an assistant timeline row, `[System Error] <error>`
// (agent-manager.ts). The server test woowtech-claude-sdk-retry.test.ts pins that row for a real
// failed download; this is where the desktop app showed its raw English text.
const failedTurnRow = (message: string) => `[System Error] ${message}`;

test("the daemon's failed-turn row for a download failure reads as the notice, in zh-TW and English", async () => {
  const error = new ClaudeAgentSdkDownloadError(undefined);
  const event = {
    type: "timeline",
    provider: "claude",
    item: { type: "assistant_message", text: failedTurnRow(error.message) },
  } as AgentStreamEventPayload;
  const [row] = reduceStreamUpdate([], event, new Date());
  expect(row?.kind).toBe("assistant_message");
  const message = claudeSdkSystemErrorMessage(row?.kind === "assistant_message" ? row.text : "");
  expect(message).toBe(error.message);
  const key = claudeSdkErrorTranslationKey("error", message ?? "");
  expect(key).toBe("woowtech.claudeSdk.download");
  try {
    await i18n.changeLanguage("zh-TW");
    expect(i18n.t(key ?? "")).toBe(
      "首次使用 Claude 需要下載元件，但目前無法連線到 registry 或鏡像站。傳送下一則訊息時會自動重試。",
    );
    await i18n.changeLanguage("en");
    expect(i18n.t(key ?? "")).toBe(
      "First use of Claude requires downloading a component, but the registry or mirror could not be reached. Send your next message to retry.",
    );
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("only the daemon's exact failed-turn row for the fork's own SDK errors is recognized", () => {
  for (const error of [
    new ClaudeAgentSdkDownloadError(undefined),
    new ClaudeAgentSdkDownloadError(503),
    new ClaudeAgentSdkIntegrityError("fixture expected", "fixture actual"),
    new ClaudeAgentSdkRuntimeError(),
  ]) {
    expect(claudeSdkSystemErrorMessage(failedTurnRow(error.message))).toBe(error.message);
  }
  for (const text of [
    download,
    `${failedTurnRow(download)}\n\ncode: 1`,
    `${failedTurnRow(download)}\n`,
    `[System Error]  ${download}`,
    `[System Error]${download}`,
    `[system error] ${download}`,
    `Agent says: ${failedTurnRow(download)}`,
    failedTurnRow(`${download} fixture-private-detail`),
    failedTurnRow("Claude Code process exited with code 1"),
    failedTurnRow("[woowtech:claude-sdk:download]"),
    "[System Error] ",
    "",
  ]) {
    expect(claudeSdkSystemErrorMessage(text)).toBeNull();
  }
});
