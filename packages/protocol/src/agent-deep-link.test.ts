import { describe, expect, it } from "vitest";
import {
  buildAgentDeepLink,
  buildAgentDeepLinkRoute,
  parseAgentDeepLink,
} from "./agent-deep-link.js";

describe("agent deep links", () => {
  it("round-trips an existing agent target", () => {
    const target = { serverId: "server/main", agentId: "agent 123" };

    const link = buildAgentDeepLink(target);

    expect(link).toBe("woowtech-smart://h/server%2Fmain/agent/agent%20123");
    expect(buildAgentDeepLinkRoute(target)).toBe("/h/server%2Fmain/agent/agent%20123");
    expect(parseAgentDeepLink(link)).toEqual(target);
  });

  it("rejects links outside the exact agent route", () => {
    expect(parseAgentDeepLink("https://h/server/agent/agent-1")).toBeNull();
    expect(parseAgentDeepLink("woowtech-smart://app/h/server/agent/agent-1")).toBeNull();
    expect(parseAgentDeepLink("woowtech-smart://h/server/agent/agent-1?message=hello")).toBeNull();
    expect(parseAgentDeepLink("woowtech-smart://h/server/agent/agent-1/extra")).toBeNull();
  });

  it("leaves upstream Paseo links to an upstream Paseo install", () => {
    expect(parseAgentDeepLink("paseo://h/server/agent/agent-1")).toBeNull();
  });
});
