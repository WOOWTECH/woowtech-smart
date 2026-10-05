// woowtech smart: tests for woowtech-attention-fallback.ts (woowtech/README.md section 16).
import { describe, expect, it } from "vitest";
import {
  ATTENTION_FALLBACK_WINDOW_MS,
  WoowtechAttentionFallback,
  answerAttentionDisplayFailure,
} from "./woowtech-attention-fallback.js";

function createLedger() {
  let nowMs = 1_000_000;
  const pushed: string[] = [];
  let phones = 1;
  const ledger = new WoowtechAttentionFallback({
    now: () => nowMs,
    hasPushTargets: () => phones > 0,
  });
  return {
    ledger,
    pushed,
    advance(ms: number) {
      nowMs += ms;
    },
    removeAllPhones() {
      phones = 0;
    },
    pushFor(label: string) {
      return () => {
        pushed.push(label);
      };
    },
  };
}

const desktop = { name: "desktop session" };
const otherClient = { name: "browser session" };
const agentNotice = {
  kind: "agent",
  agentId: "agent-b",
  timestamp: "2026-10-05T05:00:00.000Z",
} as const;

describe("a notice the picked client could not show", () => {
  it("is pushed once when that client reports it", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });

    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("pushed");
    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("unknown");

    expect(pushed).toEqual(["B finished"]);
  });

  it("is not pushed when another client reports it", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });

    expect(ledger.report({ target: agentNotice, reporter: otherClient })).toBe("unknown");
    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("pushed");

    expect(pushed).toEqual(["B finished"]);
  });

  it("matches an agent notice by its timestamp", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });

    const otherDelivery = { ...agentNotice, timestamp: "2026-10-05T05:00:09.000Z" };
    expect(ledger.report({ target: otherDelivery, reporter: desktop })).toBe("unknown");

    expect(pushed).toEqual([]);
  });

  it("is not pushed, and says so, when no phone has a push token", () => {
    const { ledger, pushed, pushFor, removeAllPhones } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });
    removeAllPhones();

    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("no_device");
    expect(pushed).toEqual([]);
  });

  it("is not pushed when the report comes after the window", () => {
    const { ledger, pushed, pushFor, advance } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });

    advance(ATTENTION_FALLBACK_WINDOW_MS + 1);

    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("expired");
    expect(pushed).toEqual([]);
  });

  it("keeps the latest notice per terminal", () => {
    const { ledger, pushed, pushFor } = createLedger();
    const terminal = { kind: "terminal", terminalId: "term-1" } as const;
    ledger.remember({ target: terminal, recipient: desktop, push: pushFor("first") });
    ledger.remember({ target: terminal, recipient: desktop, push: pushFor("second") });

    expect(ledger.report({ target: terminal, reporter: desktop })).toBe("pushed");

    expect(pushed).toEqual(["second"]);
  });

  it("forgets notices older than the window when it remembers a new one", () => {
    const { ledger, pushed, pushFor, advance } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("old") });
    advance(ATTENTION_FALLBACK_WINDOW_MS + 1);
    const later = { ...agentNotice, timestamp: "2026-10-05T05:01:01.000Z" };
    ledger.remember({ target: later, recipient: desktop, push: pushFor("new") });

    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("unknown");
    expect(ledger.report({ target: later, reporter: desktop })).toBe("pushed");
    expect(pushed).toEqual(["new"]);
  });

  it("keeps at most 64 notices, dropping the oldest", () => {
    const { ledger, pushed, pushFor } = createLedger();
    for (let index = 0; index < 65; index += 1) {
      ledger.remember({
        target: { kind: "agent", agentId: `agent-${index}`, timestamp: "t" },
        recipient: desktop,
        push: pushFor(`agent-${index}`),
      });
    }

    const oldest = { kind: "agent", agentId: "agent-0", timestamp: "t" } as const;
    const newest = { kind: "agent", agentId: "agent-64", timestamp: "t" } as const;
    expect(ledger.report({ target: oldest, reporter: desktop })).toBe("unknown");
    expect(ledger.report({ target: newest, reporter: desktop })).toBe("pushed");
    expect(pushed).toEqual(["agent-64"]);
  });
});

describe("the session's answer", () => {
  it("carries the request id and the outcome", () => {
    const { ledger, pushFor } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });

    expect(
      answerAttentionDisplayFailure({
        fallback: ledger,
        request: {
          type: "attention.notification.report_display_failure.request",
          requestId: "req-1",
          target: agentNotice,
        },
        reporter: desktop,
      }),
    ).toEqual({
      type: "attention.notification.report_display_failure.response",
      payload: { requestId: "req-1", outcome: "pushed" },
    });
  });

  it("knows no notice without a ledger", () => {
    expect(
      answerAttentionDisplayFailure({
        fallback: undefined,
        request: {
          type: "attention.notification.report_display_failure.request",
          requestId: "req-2",
          target: agentNotice,
        },
        reporter: desktop,
      }).payload.outcome,
    ).toBe("unknown");
  });
});
