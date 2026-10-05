// woowtech smart: tests for woowtech-attention-presence.ts (woowtech/README.md section 16).
import { describe, expect, it } from "vitest";
import { computeNotificationPlan, PRESENCE_THRESHOLD_MS } from "./agent-attention-policy.js";
import {
  type WoowtechClientActivity,
  woowtechClientPresenceState,
  woowtechNotificationPlanWhileStopping,
} from "./woowtech-attention-presence.js";

const nowMs = Date.parse("2026-10-01T12:00:00.000Z");

function activity(overrides: Partial<WoowtechClientActivity>): WoowtechClientActivity {
  return {
    deviceType: "mobile",
    focusedAgentId: null,
    focusedTerminalId: null,
    lastActivityAt: new Date(nowMs - 30_000),
    appVisible: true,
    ...overrides,
  };
}

function plan(activities: WoowtechClientActivity[]) {
  return computeNotificationPlan({
    allStates: activities.map(woowtechClientPresenceState),
    focusTarget: { kind: "agent", id: "agent-1" },
    pushEligible: true,
    nowMs,
  });
}

describe("woowtechClientPresenceState (proposal 1)", () => {
  it("pushes when the only phone is backgrounded 30 s after its last activity", () => {
    expect(plan([activity({ appVisible: false })])).toEqual({
      inAppRecipientIndex: null,
      shouldPush: true,
    });
  });

  it("pushes when the only phone is backgrounded just inside the presence window", () => {
    expect(
      plan([
        activity({
          appVisible: false,
          lastActivityAt: new Date(nowMs - PRESENCE_THRESHOLD_MS + 1),
        }),
      ]),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: true });
  });

  it("keeps a visible phone as the in-app recipient (no push)", () => {
    expect(plan([activity({ appVisible: true })])).toEqual({
      inAppRecipientIndex: 0,
      shouldPush: false,
    });
  });

  it("still lets a visible phone focused on the agent suppress everything", () => {
    expect(plan([activity({ appVisible: true, focusedAgentId: "agent-1" })])).toEqual({
      inAppRecipientIndex: null,
      shouldPush: false,
    });
  });

  it("does not let a backgrounded phone focused on the agent suppress the push", () => {
    expect(plan([activity({ appVisible: false, focusedAgentId: "agent-1" })])).toEqual({
      inAppRecipientIndex: null,
      shouldPush: true,
    });
  });

  it("keeps a hidden desktop window present (desktop behaviour unchanged)", () => {
    expect(plan([activity({ deviceType: "web", appVisible: false })])).toEqual({
      inAppRecipientIndex: 0,
      shouldPush: false,
    });
  });

  it("hands the notice to the present desktop instead of a more recent backgrounded phone", () => {
    expect(
      plan([
        activity({
          deviceType: "web",
          appVisible: false,
          lastActivityAt: new Date(nowMs - 60_000),
        }),
        activity({
          deviceType: "mobile",
          appVisible: false,
          lastActivityAt: new Date(nowMs - 5_000),
        }),
      ]),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });
});

describe("woowtechNotificationPlanWhileStopping (proposal 2)", () => {
  it("keeps the plan while the daemon runs", () => {
    expect(
      woowtechNotificationPlanWhileStopping({ inAppRecipientIndex: null, shouldPush: true }, false),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: true });
    expect(
      woowtechNotificationPlanWhileStopping({ inAppRecipientIndex: 2, shouldPush: false }, false),
    ).toEqual({ inAppRecipientIndex: 2, shouldPush: false });
  });

  it("notifies nobody once the daemon is stopping", () => {
    expect(
      woowtechNotificationPlanWhileStopping({ inAppRecipientIndex: null, shouldPush: true }, true),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: false });
    expect(
      woowtechNotificationPlanWhileStopping({ inAppRecipientIndex: 0, shouldPush: false }, true),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: false });
  });
});
