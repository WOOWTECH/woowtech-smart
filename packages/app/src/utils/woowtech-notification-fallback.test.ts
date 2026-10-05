// woowtech smart: tests for woowtech-notification-fallback.ts (woowtech/README.md section 16).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionDisplayFailureTarget } from "@getpaseo/protocol/woowtech-attention-fallback";
import {
  forgetNotificationDisplayFailureForTest,
  getNotificationDisplayFailure,
  handleOsNotificationResult,
  subscribeToNotificationDisplayFailure,
  type AttentionDisplayFailureReporter,
} from "./woowtech-notification-fallback";

const target: AttentionDisplayFailureTarget = {
  kind: "agent",
  agentId: "agent-b",
  timestamp: "2026-10-05T05:00:00.000Z",
};

function createDaemon(options: { supportsFallback: boolean; outcome?: string; rejects?: boolean }) {
  const reports: AttentionDisplayFailureTarget[] = [];
  const client: AttentionDisplayFailureReporter = {
    supportsAttentionDisplayFallback: () => options.supportsFallback,
    reportAttentionDisplayFailure: async (reported) => {
      reports.push(reported);
      if (options.rejects) {
        throw new Error("Transport not connected");
      }
      return { outcome: options.outcome ?? "pushed" };
    },
  };
  return { client, reports };
}

afterEach(() => {
  forgetNotificationDisplayFailureForTest();
  vi.restoreAllMocks();
});

describe("a notice the system did not show", () => {
  it("is reported to the daemon, and the callout says the phone got it", async () => {
    const { client, reports } = createDaemon({ supportsFallback: true, outcome: "pushed" });

    await handleOsNotificationResult({ shown: false, native: false, client, target });

    expect(reports).toEqual([target]);
    expect(getNotificationDisplayFailure()).toBe("sent_to_phone");
  });

  it("does not claim the phone got it when the daemon did not push it", async () => {
    const { client } = createDaemon({ supportsFallback: true, outcome: "unknown" });

    await handleOsNotificationResult({ shown: false, native: false, client, target });

    expect(getNotificationDisplayFailure()).toBe("not_sent");
  });

  it("is not reported when the system showed it", async () => {
    const { client, reports } = createDaemon({ supportsFallback: true });

    await handleOsNotificationResult({ shown: true, native: false, client, target });

    expect(reports).toEqual([]);
    expect(getNotificationDisplayFailure()).toBe("none");
  });

  it("is never reported from a phone, which only shows pushes", async () => {
    const { client, reports } = createDaemon({ supportsFallback: true });

    await handleOsNotificationResult({ shown: false, native: true, client, target });

    expect(reports).toEqual([]);
    expect(getNotificationDisplayFailure()).toBe("none");
  });

  it("is not sent to a daemon that does not know the request, which needs an update", async () => {
    const { client, reports } = createDaemon({ supportsFallback: false });

    await handleOsNotificationResult({ shown: false, native: false, client, target });

    expect(reports).toEqual([]);
    expect(getNotificationDisplayFailure()).toBe("host_too_old");
  });

  it("does not throw when the report cannot reach the daemon", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, reports } = createDaemon({ supportsFallback: true, rejects: true });

    await expect(
      handleOsNotificationResult({ shown: false, native: false, client, target }),
    ).resolves.toBeUndefined();

    expect(reports).toEqual([target]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getNotificationDisplayFailure()).toBe("not_sent");
  });

  it("keeps saying the phone got one for the rest of the launch", async () => {
    const pushed = createDaemon({ supportsFallback: true, outcome: "pushed" });
    const unknown = createDaemon({ supportsFallback: true, outcome: "unknown" });
    const seen: string[] = [];
    subscribeToNotificationDisplayFailure(() => {
      seen.push(getNotificationDisplayFailure());
    });

    await handleOsNotificationResult({
      shown: false,
      native: false,
      client: unknown.client,
      target,
    });
    await handleOsNotificationResult({
      shown: false,
      native: false,
      client: pushed.client,
      target,
    });
    await handleOsNotificationResult({
      shown: false,
      native: false,
      client: unknown.client,
      target,
    });
    await handleOsNotificationResult({
      shown: false,
      native: false,
      client: pushed.client,
      target,
    });

    expect(seen).toEqual(["not_sent", "sent_to_phone"]);
  });
});
