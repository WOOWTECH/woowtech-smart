// woowtech smart: tests for woowtech-notification-launch.ts (woowtech/README.md section 16, D2a).
import { describe, expect, it } from "vitest";
import {
  agentNotificationId,
  agentTargetForNotificationData,
  agentTargetFromLaunchInfo,
  agentTargetFromNotificationId,
} from "./woowtech-notification-launch.js";

describe("notification targets", () => {
  it("needs both a server and an agent id", () => {
    expect(agentTargetForNotificationData({ serverId: " srv ", agentId: "agt" })).toEqual({
      serverId: "srv",
      agentId: "agt",
    });
    expect(agentTargetForNotificationData({ serverId: "srv", terminalId: "t1" })).toBeNull();
    expect(agentTargetForNotificationData({ serverId: "srv", agentId: 7 })).toBeNull();
    expect(agentTargetForNotificationData(undefined)).toBeNull();
  });

  it("round-trips an agent through a macOS notification identifier", () => {
    const target = { serverId: "srv one", agentId: "agt/1" };
    const id = agentNotificationId(target, "0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(id).toBe(
      "woowtech-agent:0f8fad5b-d9cb-469f-a165-70867728950e:woowtech-smart://h/srv%20one/agent/agt%2F1",
    );
    expect(agentTargetFromNotificationId(id)).toEqual(target);
    expect(
      agentTargetFromLaunchInfo({ identifier: id, actionIdentifier: "x", userInfo: {} }),
    ).toEqual(target);
  });

  it("ignores launches that did not come from one of our agent notifications", () => {
    expect(agentTargetFromLaunchInfo({})).toBeNull();
    expect(agentTargetFromLaunchInfo(null)).toBeNull();
    expect(agentTargetFromLaunchInfo({ identifier: "5B6F1B0C-ELECTRON-RANDOM" })).toBeNull();
    expect(agentTargetFromNotificationId("woowtech-agent:no-separator")).toBeNull();
    expect(agentTargetFromNotificationId("woowtech-agent:u:woowtech-smart:///#offer=x")).toBeNull();
  });
});
