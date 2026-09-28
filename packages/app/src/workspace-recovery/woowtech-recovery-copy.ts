import { i18n } from "@/i18n/i18next";

// woowtech smart: the daemon explains an unrecoverable workspace in English. Its reason code
// picks the text in the app language. Languages without their own text, and reasons this app
// does not know, keep the daemon's words.
const KNOWN_REASONS = new Set([
  "workspace_not_found",
  "workspace_not_archived",
  "project_not_found",
  "workspace_directory_missing",
  "worktree_branch_missing",
  "project_directory_missing",
]);

export function unavailableRecoveryMessage(recovery: { reason: string; message: string }): string {
  if (!KNOWN_REASONS.has(recovery.reason)) {
    return recovery.message;
  }
  const key = `woowtech.workspaceRecovery.${recovery.reason}`;
  const translated = i18n.t(key);
  return translated === i18n.t(key, { lng: "en" }) ? recovery.message : translated;
}

/** The workspace can only be recovered by a newer app. */
export function unsupportedRecoveryMessage(): string {
  return i18n.t("woowtech.workspaceRecovery.unsupportedAction");
}
