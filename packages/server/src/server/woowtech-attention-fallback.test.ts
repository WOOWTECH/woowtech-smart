// woowtech smart: tests for woowtech-attention-fallback.ts (woowtech/README.md section 16).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTENTION_FALLBACK_WINDOW_MS,
  WoowtechAttentionFallback,
  answerAttentionDisplayFailure,
} from "./woowtech-attention-fallback.js";

function createLedger(options: { escalationMs?: number } = {}) {
  let nowMs = 1_000_000;
  const pushed: string[] = [];
  const escalated: string[] = [];
  let phones = 1;
  const ledger = new WoowtechAttentionFallback({
    now: () => nowMs,
    hasPushTargets: () => phones > 0,
    escalationMs: options.escalationMs ?? 180_000,
    onEscalated: (target) => {
      escalated.push(target.kind === "agent" ? target.agentId : target.terminalId);
    },
  });
  return {
    ledger,
    pushed,
    escalated,
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

describe("a computer's notice nobody deals with", () => {
  const unattended = { isAttendedTo: () => false };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes to the phone when the wait ends", () => {
    const { ledger, pushed, escalated, pushFor } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    vi.advanceTimersByTime(179_999);
    expect(pushed).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(pushed).toEqual(["B finished"]);
    expect(escalated).toEqual(["agent-b"]);
  });

  it("is pushed once, and its report afterwards finds nothing", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    vi.advanceTimersByTime(180_000);
    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual(["B finished"]);
    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("unknown");
  });

  it("is not pushed when someone dealt with it by the time the wait ends", () => {
    const { ledger, pushed, escalated, pushFor } = createLedger();
    let attended = false;
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: { isAttendedTo: () => attended },
    });

    attended = true;
    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual([]);
    expect(escalated).toEqual([]);
  });

  it("asks again at the end, so a notice that was attended to earlier but is open again is pushed", () => {
    const { ledger, pushed, pushFor } = createLedger();
    let attended = true;
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: { isAttendedTo: () => attended },
    });

    vi.advanceTimersByTime(90_000);
    attended = false;
    vi.advanceTimersByTime(90_000);

    expect(pushed).toEqual(["B finished"]);
  });

  it("is not pushed twice when the client reports it first", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("pushed");
    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual(["B finished"]);
  });

  it("still goes to the phone after a report that came too late", () => {
    const { ledger, pushed, pushFor, advance } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    advance(ATTENTION_FALLBACK_WINDOW_MS + 1);
    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("expired");
    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual(["B finished"]);
  });

  it("is not pushed when no phone has a push token", () => {
    const { ledger, pushed, escalated, pushFor, removeAllPhones } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    removeAllPhones();
    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual([]);
    expect(escalated).toEqual([]);
  });

  it("is not pushed without an escalation, however long it waits", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({ target: agentNotice, recipient: desktop, push: pushFor("B finished") });

    vi.advanceTimersByTime(3_600_000);

    expect(pushed).toEqual([]);
  });

  it("never waits when the wait is turned off", () => {
    const { ledger, pushed, pushFor } = createLedger({ escalationMs: 0 });
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    vi.advanceTimersByTime(3_600_000);

    expect(pushed).toEqual([]);
    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("pushed");
  });

  it("is replaced by a later notice for the same terminal, with its own wait", () => {
    const { ledger, pushed, pushFor } = createLedger();
    const terminal = { kind: "terminal", terminalId: "terminal-1" } as const;
    ledger.remember({
      target: terminal,
      recipient: desktop,
      push: pushFor("first"),
      escalation: unattended,
    });
    vi.advanceTimersByTime(100_000);
    ledger.remember({
      target: terminal,
      recipient: desktop,
      push: pushFor("second"),
      escalation: unattended,
    });

    vi.advanceTimersByTime(80_000);
    expect(pushed).toEqual([]);
    vi.advanceTimersByTime(100_000);

    expect(pushed).toEqual(["second"]);
  });

  it("stays past the report window until its wait ends", () => {
    const { ledger, pushed, pushFor, advance } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("old"),
      escalation: unattended,
    });
    advance(ATTENTION_FALLBACK_WINDOW_MS + 1);
    const later = { ...agentNotice, timestamp: "2026-10-05T05:01:01.000Z" };
    ledger.remember({ target: later, recipient: desktop, push: pushFor("new") });

    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual(["old"]);
  });

  it("drops the oldest of 65 waiting notices, and its wait", () => {
    const { ledger, pushed, pushFor } = createLedger();
    for (let index = 0; index < 65; index += 1) {
      ledger.remember({
        target: { kind: "agent", agentId: `agent-${index}`, timestamp: "t" },
        recipient: desktop,
        push: pushFor(`agent-${index}`),
        escalation: unattended,
      });
    }

    vi.advanceTimersByTime(180_000);

    expect(pushed).not.toContain("agent-0");
    expect(pushed).toHaveLength(64);
  });

  it("stops every wait when the daemon is stopping", () => {
    const { ledger, pushed, pushFor } = createLedger();
    ledger.remember({
      target: agentNotice,
      recipient: desktop,
      push: pushFor("B finished"),
      escalation: unattended,
    });

    ledger.close();
    vi.advanceTimersByTime(180_000);

    expect(pushed).toEqual([]);
    expect(ledger.report({ target: agentNotice, reporter: desktop })).toBe("unknown");
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
