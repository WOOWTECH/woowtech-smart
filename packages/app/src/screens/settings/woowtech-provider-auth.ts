import type { TFunction } from "i18next";
import type { ProviderAuthStatus } from "@getpaseo/protocol/woowtech-provider-auth";

// woowtech smart: a ready provider's login state in the provider list (woowtech/README.md §3).
// Display only. Entries from a daemon that does not send it, and providers that are not ready,
// show exactly as before.

export interface ProviderAuthDisplay {
  tone: "success" | "warning";
  /** The status label next to the provider's name. */
  label: string;
  /** The line under the provider's name. */
  detail: string;
}

export interface ProviderAuthEntry {
  status: string;
  enabled: boolean;
  auth?: ProviderAuthStatus;
}

function describeDetail(auth: ProviderAuthStatus, t: TFunction): string {
  if (auth.state === "signed_in") {
    return auth.method === "subscription"
      ? t("woowtech.claudeAuth.subscription")
      : t("woowtech.claudeAuth.signedIn");
  }
  if (auth.state === "configured") {
    if (auth.method === "api_key") return t("woowtech.claudeAuth.apiKey");
    if (auth.method === "auth_token") return t("woowtech.claudeAuth.authToken");
    if (auth.method === "oauth_token") return t("woowtech.claudeAuth.oauthToken");
    return t("woowtech.claudeAuth.configured");
  }
  // "unknown", and any state a newer daemon adds.
  return t("woowtech.claudeAuth.unknown");
}

export function describeProviderAuth(
  entry: ProviderAuthEntry,
  t: TFunction,
): ProviderAuthDisplay | null {
  const { auth } = entry;
  if (!entry.enabled || entry.status !== "ready" || !auth) return null;
  if (auth.state === "needs_login") {
    return {
      tone: "warning",
      label: t("woowtech.claudeAuth.needsLogin"),
      detail: t("woowtech.claudeAuth.needsLoginHint"),
    };
  }
  return {
    tone: "success",
    label: t("settings.providers.statuses.available"),
    detail: describeDetail(auth, t),
  };
}
