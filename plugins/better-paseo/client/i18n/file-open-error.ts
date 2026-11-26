import { getEnhancerPreferences } from "../preferences";
import { resolveLanguage, type SettingsLanguage } from "./settings-strings";
import { FILE_OPEN_LABELS, type FileOpenApp } from "../../shared/file-open-apps";
import type { FileOpenErrorKind } from "../../shared/file-rpc";

type RevealResult = {
  error: string | null;
  errorKind?: FileOpenErrorKind;
  errorApp?: FileOpenApp;
  errorCode?: "system_opener_unavailable";
};

/**
 * A path press: opens or reveals the path on the host with the current file
 * open setting, and shows any failure in a toast.
 */
export function revealWithSetting(
  revealPath: (input: {
    cwd: string;
    path: string;
    expectedApp: FileOpenApp;
  }) => Promise<RevealResult>,
  toast: { error(message: string): void },
  cwd: string,
  path: string,
): void {
  void revealPath({ cwd, path, expectedApp: getEnhancerPreferences().fileOpenApp })
    .then((result) => {
      if (result.error) toast.error(fileOpenError(result));
    })
    .catch((error: unknown) => toast.error(String(error)));
}

const names: Record<FileOpenApp, string> = { system: "System app", ...FILE_OPEN_LABELS };

/** Server details are retained for diagnosis, including with older servers. */
export function fileOpenError(
  result: RevealResult,
  language: SettingsLanguage = resolveLanguage(getEnhancerPreferences().language),
): string {
  const detail = result.error ?? "";
  if (
    result.errorCode === "system_opener_unavailable" ||
    result.errorKind === "system_opener_unavailable"
  ) {
    return language === "zh-TW"
      ? `daemon 主機找不到 xdg-open。請安裝 xdg-open 並確認它在 daemon 的 PATH 中：${detail}`
      : language === "zh"
        ? `daemon 主机找不到 xdg-open。请安装 xdg-open 并确认它在 daemon 的 PATH 中：${detail}`
        : `The daemon host could not find xdg-open. Install xdg-open and ensure it is in the daemon's PATH: ${detail}`;
  }
  if (language === "en" || !result.errorKind) return detail;
  if (result.errorKind === "settings_unavailable")
    return language === "zh-TW" ? "檔案開啟設定不可用" : "文件打开设置不可用";
  if (result.errorKind === "settings_unsynced")
    return language === "zh-TW"
      ? "檔案開啟設定尚未同步，請稍後重試"
      : "文件打开设置尚未同步，请稍后重试";
  if (result.errorKind === "launch_unconfirmed")
    return language === "zh-TW"
      ? "無法確認是否開啟，目標可能已經開啟"
      : "无法确认是否打开，目标可能已经打开";
  const app = result.errorApp ? names[result.errorApp] : "";
  if (result.errorKind === "editor_unavailable")
    return language === "zh-TW"
      ? `${app} 未安裝或其命令不在 PATH 中`
      : `${app} 未安装或其命令不在 PATH 中`;
  const exit = detail.match(
    /^Failed to open (?:path|file with \w+) \(exit (\d+)\)(?:: ([\s\S]+))?$/,
  );
  if (exit)
    return language === "zh-TW"
      ? `${result.errorApp === "system" ? "開啟失敗" : `${app} 開啟失敗`}（退出碼 ${exit[1]}）${exit[2] ? `：${exit[2]}` : ""}`
      : `${result.errorApp === "system" ? "打开失败" : `${app} 打开失败`}（退出码 ${exit[1]}）${exit[2] ? `：${exit[2]}` : ""}`;
  return language === "zh-TW"
    ? `${result.errorApp && result.errorApp !== "system" ? `${app} 開啟失敗` : "開啟失敗"}：${detail}`
    : `${result.errorApp && result.errorApp !== "system" ? `${app} 打开失败` : "打开失败"}：${detail}`;
}
