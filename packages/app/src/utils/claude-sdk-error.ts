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
