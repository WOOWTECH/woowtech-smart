import { ClaudeAgentSdkDownloadError } from "../../../server/src/server/agent/providers/claude/claude-agent-sdk-download";
import { ClaudeAgentSdkIntegrityError } from "../../../server/src/server/agent/providers/claude/claude-agent-sdk-runtime";
import { ClaudeAgentSdkRuntimeError } from "../../../server/src/server/agent/providers/claude/claude-agent-sdk-installation";
import { expect, test } from "vitest";
import { claudeSdkErrorTranslationKey } from "./claude-sdk-error";
import { woowtechCopyFor } from "../i18n/woowtech-copy";

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
