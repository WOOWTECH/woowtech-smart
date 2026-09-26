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
