// woowtech smart: tests for woowtech-attention-escalation.ts (woowtech/README.md section 16).
import { describe, expect, it } from "vitest";
import {
  ATTENTION_ESCALATION_MS,
  readEscalationDelayMs,
  recipientAttendedTo,
  waitsBeforePhoneGetsNotice,
  type NoticeRecipientActivity,
} from "./woowtech-attention-escalation.js";

const NOTICED_AT_MS = Date.parse("2026-10-06T10:00:00.000Z");

function activity(overrides: Partial<NoticeRecipientActivity> = {}): NoticeRecipientActivity {
  return {
    deviceType: "web",
    focusedAgentId: null,
    focusedTerminalId: null,
    lastActivityAt: new Date(NOTICED_AT_MS - 5_000),
    appVisible: true,
    ...overrides,
  };
}

describe("the wait before the phone gets an unattended notice", () => {
  it("is three minutes unless the environment says otherwise", () => {
    expect(ATTENTION_ESCALATION_MS).toBe(180_000);
    expect(readEscalationDelayMs({})).toBe(180_000);
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: "  " })).toBe(180_000);
  });

  it("reads seconds from WOOWTECH_ESCALATION_SECONDS", () => {
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: "30" })).toBe(30_000);
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: " 2.5 " })).toBe(2_500);
  });

  it("is turned off by 0", () => {
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: "0" })).toBe(0);
  });

  it("keeps the default for a value it cannot use", () => {
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: "soon" })).toBe(180_000);
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: "-5" })).toBe(180_000);
    expect(readEscalationDelayMs({ WOOWTECH_ESCALATION_SECONDS: "Infinity" })).toBe(180_000);
  });
});

describe("who waits", () => {
  it("is a computer, because its notice is a banner the system can drop", () => {
    expect(waitsBeforePhoneGetsNotice(activity({ deviceType: "web" }))).toBe(true);
  });

  it("is not a phone, which is the phone already", () => {
    expect(waitsBeforePhoneGetsNotice(activity({ deviceType: "mobile" }))).toBe(false);
  });

  it("is not a client that sent no activity", () => {
    expect(waitsBeforePhoneGetsNotice(null)).toBe(false);
  });
});

describe("a notice someone is dealing with", () => {
  const agent = { kind: "agent", id: "agent-b" } as const;
  const terminal = { kind: "terminal", id: "terminal-1" } as const;

  it("is not one when the recipient has gone", () => {
    expect(recipientAttendedTo({ activity: null, noticedAtMs: NOTICED_AT_MS, target: agent })).toBe(
      false,
    );
  });

  it("is not one when the recipient has been idle since before the notice", () => {
    expect(
      recipientAttendedTo({ activity: activity(), noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(false);
  });

  it("is one when the recipient saw input after the notice", () => {
    const afterwards = activity({ lastActivityAt: new Date(NOTICED_AT_MS + 1) });
    expect(
      recipientAttendedTo({ activity: afterwards, noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(true);
  });

  it("is not one for input at the very moment of the notice", () => {
    const sameMoment = activity({ lastActivityAt: new Date(NOTICED_AT_MS) });
    expect(
      recipientAttendedTo({ activity: sameMoment, noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(false);
  });

  it("is one when the visible app is looking at that agent", () => {
    const looking = activity({ focusedAgentId: "agent-b" });
    expect(
      recipientAttendedTo({ activity: looking, noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(true);
  });

  it("is not one when the app that was looking at the agent is hidden", () => {
    const hidden = activity({ focusedAgentId: "agent-b", appVisible: false });
    expect(
      recipientAttendedTo({ activity: hidden, noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(false);
  });

  it("is not one when the app is looking at another agent", () => {
    const elsewhere = activity({ focusedAgentId: "agent-c" });
    expect(
      recipientAttendedTo({ activity: elsewhere, noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(false);
  });

  it("follows the terminal for a terminal notice", () => {
    const looking = activity({ focusedTerminalId: "terminal-1" });
    expect(
      recipientAttendedTo({ activity: looking, noticedAtMs: NOTICED_AT_MS, target: terminal }),
    ).toBe(true);
    expect(
      recipientAttendedTo({ activity: looking, noticedAtMs: NOTICED_AT_MS, target: agent }),
    ).toBe(false);
  });
});
