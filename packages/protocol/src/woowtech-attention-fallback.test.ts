// woowtech smart: tests for woowtech-attention-fallback.ts (woowtech/README.md section 16).
import { describe, expect, test } from "vitest";
import {
  parseServerInfoStatusPayload,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("reports of notices the system did not show", () => {
  test("an agent notice report is a session request", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "attention.notification.report_display_failure.request",
      requestId: "req-1",
      target: { kind: "agent", agentId: "agent-b", timestamp: "2026-10-05T05:00:00.000Z" },
    });

    expect(parsed).toEqual({
      type: "attention.notification.report_display_failure.request",
      requestId: "req-1",
      target: { kind: "agent", agentId: "agent-b", timestamp: "2026-10-05T05:00:00.000Z" },
    });
  });

  test("a terminal notice report needs no timestamp", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "attention.notification.report_display_failure.request",
      requestId: "req-2",
      target: { kind: "terminal", terminalId: "term-1" },
    });

    expect(parsed.success).toBe(true);
  });

  test("an agent notice report without its timestamp is rejected", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "attention.notification.report_display_failure.request",
      requestId: "req-3",
      target: { kind: "agent", agentId: "agent-b" },
    });

    expect(parsed.success).toBe(false);
  });

  test("the answer parses with an outcome a later daemon may add", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "attention.notification.report_display_failure.response",
      payload: { requestId: "req-1", outcome: "queued" },
    });

    expect(parsed).toEqual({
      type: "attention.notification.report_display_failure.response",
      payload: { requestId: "req-1", outcome: "queued" },
    });
  });

  test("the daemon advertises it with woowtechAttentionFallback", () => {
    const parsed = parseServerInfoStatusPayload({
      status: "server_info",
      serverId: "srv-test",
      features: { woowtechPush: true, woowtechAttentionFallback: true },
    });

    expect(parsed?.features).toEqual({ woowtechPush: true, woowtechAttentionFallback: true });
  });
});
