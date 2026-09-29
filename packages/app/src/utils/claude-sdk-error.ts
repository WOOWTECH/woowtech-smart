type ClaudeSdkErrorKey =
  | "woowtech.claudeSdk.download"
  | "woowtech.claudeSdk.integrity"
  | "woowtech.claudeSdk.runtime";

/** Match the entire safe wire message, not a marker embedded in arbitrary provider output. */
export function claudeSdkErrorTranslationKey(
  level: string,
  message: string,
): ClaudeSdkErrorKey | null {
  if (level !== "error") return null;
  const downloadMatch =
    /^\[woowtech:claude-sdk:download\] Claude Agent SDK download failed(?: with HTTP [1-5][0-9]{2})?\. First use of Claude requires downloading a component, but the registry or mirror could not be reached\. Send your next message to retry\.$/.exec(
      message,
    );
  if (downloadMatch?.[0] === message) return "woowtech.claudeSdk.download";
  if (
    message ===
    "[woowtech:claude-sdk:integrity] Claude Agent SDK download failed its integrity check; refusing to install it. Send your next message to retry."
  )
    return "woowtech.claudeSdk.integrity";
  if (
    message ===
    "[woowtech:claude-sdk:runtime] Claude component could not be installed or loaded. Send your next message to retry."
  )
    return "woowtech.claudeSdk.runtime";
  return null;
}

/** agent-manager writes a failed turn into the timeline as this prefix plus the error. */
const FAILED_TURN_PREFIX = "[System Error] ";

/**
 * The fork's own SDK error inside the daemon's failed-turn row, `[System Error] <error>`, or null.
 * Only a row that is exactly the prefix and a complete fork error qualifies, so agent text, other
 * failures and rows with extra detail stay as they are.
 */
export function claudeSdkSystemErrorMessage(text: string): string | null {
  if (!text.startsWith(FAILED_TURN_PREFIX)) return null;
  const message = text.slice(FAILED_TURN_PREFIX.length);
  return claudeSdkErrorTranslationKey("error", message) ? message : null;
}
