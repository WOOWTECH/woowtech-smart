import { expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  getHostPickerLabel,
  buildHostPickerOptions,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  hostIdTag,
  hostsSharingAName,
  hostSubtitle,
} from "./host-picker-constants";

const hosts = [{ serverId: "host-a", label: "Host A" }];

it.each([
  ["host-a", undefined, "Host A"],
  ["missing", undefined, "Host"],
  [ALL_HOSTS_OPTION_ID, { includeAllHost: true }, "All hosts"],
  ["missing", { includeAllHost: true }, "All hosts"],
  [ALL_HOSTS_OPTION_ID, undefined, "Host"],
  [ADD_HOST_OPTION_ID, { includeAddHost: true }, "Add host"],
])("resolves %s", (value, config, expected) => {
  expect(getHostPickerLabel(hosts, value, config)).toBe(expected);
});

it("updates visible and searchable labels together when the language changes", async () => {
  const config = { includeAllHost: true, includeAddHost: true, includeEnableBuiltInDaemon: true };
  try {
    await i18n.changeLanguage("zh-TW");
    expect(getHostPickerLabel(hosts, ALL_HOSTS_OPTION_ID, config)).toBe("所有主機");
    expect(buildHostPickerOptions(hosts, config)).toEqual([
      { id: ALL_HOSTS_OPTION_ID, label: "所有主機" },
      { id: "host-a", label: "Host A" },
      { id: ADD_HOST_OPTION_ID, label: "新增主機" },
      { id: ENABLE_BUILT_IN_DAEMON_OPTION_ID, label: "啟用內建 Daemon" },
    ]);
    expect(
      buildHostPickerOptions(hosts, config).filter(({ label }) => label.includes("新增")),
    ).toEqual([{ id: ADD_HOST_OPTION_ID, label: "新增主機" }]);
    expect(getHostPickerLabel(hosts, ADD_HOST_OPTION_ID, config)).toBe("新增主機");
    expect(getHostPickerLabel(hosts, "missing")).toBe("主機");
    expect(getHostPickerLabel(hosts, "host-a", config)).toBe("Host A");
    expect(
      ["search", "title", "local", "filterTitle"].map((key) =>
        i18n.t(`woowtech.hostPicker.${key}`),
      ),
    ).toEqual(["搜尋主機", "主機", "本機", "依主機篩選"]);
    expect(i18n.t("woowtech.hostPicker.openSettings", { host: "Host A" })).toBe(
      "開啟 Host A 的設定",
    );
    expect(i18n.t("woowtech.hostPicker.filter", { host: "Host A" })).toBe("篩選：Host A");
    await i18n.changeLanguage("zh-CN");
    expect(buildHostPickerOptions(hosts, config).map(({ label }) => label)).toEqual([
      "所有主机",
      "Host A",
      "添加主机",
      "启用内置 Daemon",
    ]);
    await i18n.changeLanguage("en");
    expect(buildHostPickerOptions(hosts, config).map(({ label }) => label)).toEqual([
      "All hosts",
      "Host A",
      "Add host",
      "Enable built-in daemon",
    ]);
    expect(getHostPickerLabel(hosts, ALL_HOSTS_OPTION_ID, config)).toBe("All hosts");
  } finally {
    await i18n.changeLanguage("en");
  }
});

// woowtech smart: telling hosts with the same name apart (woowtech/README.md section 25, K-34).
it("tags only the hosts whose name another host also has", () => {
  const shared = hostsSharingAName([
    { serverId: "srv_xdz4gLQn_GRS", label: "woowtechmacbook.local" },
    { serverId: "srv_9t3UPf7qZbJu", label: "woowtechmacbook.local" },
    { serverId: "srv_other", label: "studio-mac.local" },
  ]);
  expect([...shared].sort()).toEqual(["srv_9t3UPf7qZbJu", "srv_xdz4gLQn_GRS"]);
});

it("puts a short id after the address of a host that shares its name", () => {
  expect(hostIdTag("srv_9t3UPf7qZbJu")).toBe("9t3U");
  expect(
    hostSubtitle({
      connectionLabel: "relay.woowtech.io",
      serverId: "srv_9t3UPf7qZbJu",
      sharesName: true,
    }),
  ).toBe("relay.woowtech.io · 9t3U");
  expect(
    hostSubtitle({ connectionLabel: undefined, serverId: "srv_9t3UPf7qZbJu", sharesName: true }),
  ).toBe("9t3U");
  expect(
    hostSubtitle({
      connectionLabel: "relay.woowtech.io",
      serverId: "srv_9t3UPf7qZbJu",
      sharesName: false,
    }),
  ).toBe("relay.woowtech.io");
});
