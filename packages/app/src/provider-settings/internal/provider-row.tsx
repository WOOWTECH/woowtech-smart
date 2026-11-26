import type { ProviderAuthStatus } from "@getpaseo/protocol/woowtech-provider-auth";
import { describeProviderAuth } from "@/screens/settings/woowtech-provider-auth";
import type { TFunction } from "i18next";
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsDetailRow, type SettingsRowHintStatus } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { rowHasSwitch, type RowSummary } from "./row-summary";

export interface ProviderRowProps {
  provider: string;
  label: string;
  icon: ReactNode;
  summary: RowSummary;
  auth?: ProviderAuthStatus;
  enabled: boolean;
  /** The Enabled switch is being saved. */
  toggling: boolean;
  onOpen: (provider: string) => void;
  onToggle: (provider: string, enabled: boolean) => void;
}

/**
 * One provider in the list: its icon and name, a line saying how it is, the Enabled switch when
 * there is something to switch, and the chevron to its detail.
 */
export function ProviderRow({
  provider,
  label,
  icon,
  summary,
  auth,
  enabled,
  toggling,
  onOpen,
  onToggle,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpen(provider), [onOpen, provider]);
  const handleToggle = useCallback(
    (value: boolean) => onToggle(provider, value),
    [onToggle, provider],
  );
  const hint = describeRowSummary(summary, t);
  const login = describeProviderAuth(
    {
      status: summary.kind === "ready" || summary.kind === "updateAvailable" ? "ready" : "loading",
      enabled,
      auth,
    },
    t,
  );
  let loginHint: string | null = null;
  if (login) {
    loginHint =
      login.tone === "warning"
        ? t("woowtech.claudeAuth.hintWithStatus", { status: login.label, hint: login.detail })
        : login.detail;
  }
  const hasVersionOrModels =
    summary.kind === "updateAvailable" ||
    (summary.kind === "ready" && Boolean(summary.version || summary.models > 0));
  const hintText = loginHint
    ? [loginHint, hasVersionOrModels ? hint.text : null].filter(Boolean).join(" · ")
    : hint.text;
  const rowLabel = t("settings.providers.providerDetails", { name: label });
  const hasSwitch = rowHasSwitch(summary);
  const toggle = useMemo(
    () =>
      hasSwitch ? (
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={toggling}
          accessibilityLabel={t("settings.providers.enableProvider", { name: label })}
        />
      ) : null,
    [enabled, handleToggle, hasSwitch, label, t, toggling],
  );
  return (
    <SettingsDetailRow
      leading={icon}
      label={label}
      hint={hintText}
      hintStatus={hint.status}
      control={toggle}
      accessibilityLabel={
        loginHint
          ? t("woowtech.claudeAuth.rowWithStatus", { row: rowLabel, status: loginHint })
          : rowLabel
      }
      onPress={handleOpen}
      testID={`provider-row-${provider}`}
    />
  );
}

function describeRowSummary(
  summary: RowSummary,
  t: TFunction,
): { text: string | undefined; status: SettingsRowHintStatus | undefined } {
  switch (summary.kind) {
    case "pending":
      return { text: undefined, status: "pending" };
    case "ready": {
      const models =
        summary.models === 1
          ? t("settings.providers.models.one")
          : t("settings.providers.models.many", { count: summary.models });
      const parts = [summary.version, summary.models > 0 ? models : null].filter(Boolean);
      return {
        text: parts.length ? parts.join(" · ") : t("settings.providers.statuses.available"),
        status: undefined,
      };
    }
    case "updateAvailable":
      return {
        text: [summary.version, t("settings.providers.installation.updateAvailable")]
          .filter(Boolean)
          .join(" · "),
        status: undefined,
      };
    case "updating":
      return {
        text: summary.target
          ? t("settings.providers.list.updatingTo", { version: summary.target })
          : t("settings.providers.installation.updating"),
        status: "busy",
      };
    case "failing":
      return {
        text: summary.message ?? t("settings.providers.diagnostic.unknownError"),
        status: "error",
      };
    case "notInstalled":
      return { text: t("settings.providers.statuses.notInstalled"), status: undefined };
    case "disabled":
      return { text: t("settings.providers.statuses.disabled"), status: undefined };
  }
}
