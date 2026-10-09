// woowtech smart: providers name their permission modes in English ("Always Ask", "Accept File
// Edits"), and the composer's mode chip and the mode menu showed them as they came. The names the
// built-in providers send (packages/protocol/src/provider-manifest.ts) get Traditional Chinese;
// any other name, and every other language, keeps upstream's formatting (woowtech/README.md,
// section 25).
const ZH_TW_MODE_LABELS: Readonly<Record<string, string>> = {
  "Plan Mode": "計畫模式",
  Plan: "計畫",
  "Always Ask": "一律詢問",
  "Accept File Edits": "自動接受檔案編輯",
  "Auto mode": "自動模式",
  Bypass: "略過權限",
  "Default Permissions": "預設權限",
  "Auto-review": "自動審查",
  "Full Access": "完整權限",
  "Allow All": "全部允許",
  // Agent stays English in Traditional Chinese (woowtech/README.md, section 7).
  Agent: "Agent",
  Build: "建置",
  "Write Approval": "寫入前核准",
  "Auto Accept": "自動接受",
  Default: "預設",
};

/** The mode's name in the app's language, or null to format the provider's name as upstream does. */
export function woowtechModeLabel(
  label: string | null | undefined,
  language: string,
): string | null {
  if (!label || language !== "zh-TW") {
    return null;
  }
  return ZH_TW_MODE_LABELS[label.trim()] ?? null;
}
