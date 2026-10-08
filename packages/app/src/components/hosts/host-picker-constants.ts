import type { TFunction } from "i18next";
import { i18n } from "@/i18n/i18next";

export const ADD_HOST_OPTION_ID = "__add_host__";
export const ALL_HOSTS_OPTION_ID = "__all_hosts__";
export const ENABLE_BUILT_IN_DAEMON_OPTION_ID = "__enable_built_in_daemon__";

interface HostPickerConfig {
  includeAllHost?: boolean;
  includeAddHost?: boolean;
  includeEnableBuiltInDaemon?: boolean;
}

/** The same labels drive search and rendered options; host names remain user content. */
export function buildHostPickerOptions(
  hosts: Array<{ label: string; serverId: string }>,
  config: HostPickerConfig,
  t: TFunction = i18n.t,
): Array<{ id: string; label: string }> {
  const options = hosts.map((host) => ({ id: host.serverId, label: host.label }));
  if (config.includeAllHost) {
    options.unshift({ id: ALL_HOSTS_OPTION_ID, label: t("woowtech.hostPicker.all") });
  }
  if (config.includeAddHost) {
    options.push({ id: ADD_HOST_OPTION_ID, label: t("woowtech.hostPicker.add") });
  }
  if (config.includeEnableBuiltInDaemon) {
    options.push({
      id: ENABLE_BUILT_IN_DAEMON_OPTION_ID,
      label: t("woowtech.hostPicker.enableBuiltInDaemon"),
    });
  }
  return options;
}

export function getHostPickerLabel(
  hosts: Array<{ label: string; serverId: string }>,
  value: string,
  config?: HostPickerConfig,
  t: TFunction = i18n.t,
): string {
  if (config?.includeAllHost && value === ALL_HOSTS_OPTION_ID) {
    return t("woowtech.hostPicker.all");
  }
  if (config?.includeAddHost && value === ADD_HOST_OPTION_ID) {
    return t("woowtech.hostPicker.add");
  }
  return (
    hosts.find((host) => host.serverId === value)?.label ??
    t(config?.includeAllHost ? "woowtech.hostPicker.all" : "woowtech.hostPicker.title")
  );
}

// woowtech smart: telling hosts with the same name apart (woowtech/README.md section 25, K-34).
/** A short tag from a host's server id: srv_9t3UPf7qZbJu reads as 9t3U. */
export function hostIdTag(serverId: string): string {
  return serverId.replace(/^srv_/, "").slice(0, 4);
}

/** The server ids of hosts that share their name with another host. */
export function hostsSharingAName(
  hosts: readonly { serverId: string; label: string }[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const host of hosts) {
    counts.set(host.label, (counts.get(host.label) ?? 0) + 1);
  }
  return new Set(
    hosts.filter((host) => (counts.get(host.label) ?? 0) > 1).map((host) => host.serverId),
  );
}

/**
 * The line under a host's name. A phone reaches every host through the same relay, so two hosts
 * with the same name also share the address (2026-10-08): those get a short id tag as well.
 */
export function hostSubtitle(input: {
  connectionLabel: string | undefined;
  serverId: string;
  sharesName: boolean;
}): string | undefined {
  if (!input.sharesName) {
    return input.connectionLabel;
  }
  const tag = hostIdTag(input.serverId);
  return input.connectionLabel ? `${input.connectionLabel} · ${tag}` : tag;
}
