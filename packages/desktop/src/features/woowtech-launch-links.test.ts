import { describe, expect, it } from "vitest";
import {
  createDuplicateLaunchFilter,
  hasAppSchemeLink,
  isAppSchemeLink,
  redactLaunchArgument,
  redactLaunchArguments,
} from "./woowtech-launch-links.js";

const PAIRING_LINK = "woowtech-smart:///#offer=eyJzZXJ2ZXJJZCI6InNydiJ9";

describe("launch link redaction", () => {
  it("never keeps the pairing offer", () => {
    expect(redactLaunchArgument(PAIRING_LINK)).toBe("woowtech-smart:///#<redacted>");
    expect(redactLaunchArgument("https://app.example/#offer=secret")).toBe(
      "https://app.example/#<redacted>",
    );
    expect(redactLaunchArgument("WOOWTECH-SMART:///?x=1&offer=secret")).toBe(
      "WOOWTECH-SMART:///?<redacted>",
    );
  });

  it("drops any query or fragment of an app link but keeps agent links readable", () => {
    expect(redactLaunchArgument("woowtech-smart://h/srv/agent/agt")).toBe(
      "woowtech-smart://h/srv/agent/agt",
    );
    expect(redactLaunchArgument("woowtech-smart://h/srv/agent/agt?token=abc")).toBe(
      "woowtech-smart://h/srv/agent/agt?<redacted>",
    );
  });

  it("leaves executables, flags and paths alone", () => {
    const argv = ["C:\\Programs\\woowtech smart\\woowtech smart.exe", "--flag", "D:\\repo"];
    expect(redactLaunchArguments(argv)).toEqual(argv);
    expect(redactLaunchArguments([...argv, PAIRING_LINK])).toEqual([
      ...argv,
      "woowtech-smart:///#<redacted>",
    ]);
  });
});

describe("app scheme detection", () => {
  it("treats any woowtech-smart: argument as an app link", () => {
    expect(isAppSchemeLink(PAIRING_LINK)).toBe(true);
    expect(isAppSchemeLink("  Woowtech-Smart://h/s/agent/a")).toBe(true);
    expect(isAppSchemeLink("paseo://h/s/agent/a")).toBe(false);
    expect(isAppSchemeLink("C:\\woowtech-smart")).toBe(false);
    expect(hasAppSchemeLink(["exe", "--x", PAIRING_LINK])).toBe(true);
    expect(hasAppSchemeLink(["exe", "D:\\repo"])).toBe(false);
  });
});

describe("duplicate agent launches", () => {
  it("drops the same agent again within the window and lets others through", () => {
    let clock = 1_000;
    const isNew = createDuplicateLaunchFilter(2_000, () => clock);
    const a = { serverId: "srv", agentId: "a" };
    expect(isNew(a)).toBe(true);
    clock += 500;
    expect(isNew(a)).toBe(false);
    expect(isNew({ serverId: "srv", agentId: "b" })).toBe(true);
    expect(isNew(a)).toBe(true);
    clock += 2_500;
    expect(isNew(a)).toBe(true);
  });
});
