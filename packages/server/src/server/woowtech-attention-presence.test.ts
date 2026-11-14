// woowtech smart: tests for woowtech-attention-presence.ts (woowtech/README.md section 16).
import { describe, expect, it } from "vitest";
import { computeNotificationPlan, PRESENCE_THRESHOLD_MS } from "./agent-attention-policy.js";
import {
  type WoowtechClientActivity,
  type WoowtechNoticeCandidate,
  woowtechClientPresenceState,
  woowtechIsPushEligibleAttentionReason,
  woowtechNotificationPlanWhileStopping,
  woowtechNotificationPlanWithoutPhone,
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

describe("woowtechNotificationPlanWithoutPhone (owner 2026-11-14)", () => {
  const away = (minutes: number) => new Date(nowMs - minutes * 60_000);

  /** Upstream's plan for these clients, then the rule; null is a client without a heartbeat. */
  function planWithoutPhone(
    activities: Array<WoowtechClientActivity | null>,
    options: { phoneHasToken?: boolean; pushEligible?: boolean } = {},
  ) {
    const clients: WoowtechNoticeCandidate[] = activities.map((entry) => ({
      state: entry
        ? woowtechClientPresenceState(entry)
        : {
            appVisible: false,
            focusedAgentId: null,
            focusedTerminalId: null,
            lastActivityAtMs: null,
          },
      deviceType: entry?.deviceType ?? null,
    }));
    return woowtechNotificationPlanWithoutPhone({
      plan: computeNotificationPlan({
        allStates: clients.map(({ state }) => state),
        focusTarget: { kind: "agent", id: "agent-1" },
        pushEligible: options.pushEligible ?? true,
        nowMs,
      }),
      clients,
      hasPushTargets: () => options.phoneHasToken ?? false,
      nowMs,
    });
  }

  it("asks the computer used last when nobody is present and no phone has a push token", () => {
    expect(
      planWithoutPhone([
        activity({ deviceType: "web", appVisible: false, lastActivityAt: away(30) }),
        activity({ deviceType: "web", appVisible: true, lastActivityAt: away(4) }),
      ]),
    ).toEqual({ inAppRecipientIndex: 1, shouldPush: false });
  });

  it("keeps the push when a phone has a push token", () => {
    expect(
      planWithoutPhone(
        [activity({ deviceType: "web", appVisible: true, lastActivityAt: away(4) })],
        {
          phoneHasToken: true,
        },
      ),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: true });
  });

  it("leaves a present recipient alone without asking about phones", () => {
    const hasPushTargets = () => {
      throw new Error("asked about phones although someone is present");
    };
    const clients: WoowtechNoticeCandidate[] = [
      {
        deviceType: "web",
        state: woowtechClientPresenceState(
          activity({ deviceType: "web", lastActivityAt: away(1) }),
        ),
      },
    ];
    expect(
      woowtechNotificationPlanWithoutPhone({
        plan: { inAppRecipientIndex: 0, shouldPush: false },
        clients,
        hasPushTargets,
        nowMs,
      }),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });

  it("still notifies nobody while someone present is looking at the agent", () => {
    expect(
      planWithoutPhone([
        activity({
          deviceType: "web",
          appVisible: true,
          focusedAgentId: "agent-1",
          lastActivityAt: away(1),
        }),
        activity({ deviceType: "web", appVisible: false, lastActivityAt: away(20) }),
      ]),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: false });
  });

  it("never asks a phone or a client without a heartbeat", () => {
    expect(
      planWithoutPhone([
        activity({ deviceType: "mobile", appVisible: true, lastActivityAt: away(4) }),
        activity({ deviceType: "mobile", appVisible: false, lastActivityAt: away(1) }),
        null,
      ]),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: true });
  });

  it("asks the computer although a backgrounded phone was used more recently", () => {
    expect(
      planWithoutPhone([
        activity({ deviceType: "mobile", appVisible: false, lastActivityAt: away(1) }),
        activity({ deviceType: "web", appVisible: false, lastActivityAt: away(45) }),
      ]),
    ).toEqual({ inAppRecipientIndex: 1, shouldPush: false });
  });

  it("shows errors on the computer too, as it does for a present user", () => {
    expect(
      planWithoutPhone([activity({ deviceType: "web", lastActivityAt: away(10) })], {
        pushEligible: woowtechIsPushEligibleAttentionReason("error"),
      }),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });

  it("asks the computer about a notice that would not push as well", () => {
    expect(
      planWithoutPhone([activity({ deviceType: "web", lastActivityAt: away(10) })], {
        pushEligible: false,
      }),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });

  it("asks the first of two computers used at the same moment", () => {
    expect(
      planWithoutPhone([
        activity({ deviceType: "web", lastActivityAt: away(10) }),
        activity({ deviceType: "web", lastActivityAt: away(10) }),
      ]),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });

  it("changes nothing with no client to ask", () => {
    expect(planWithoutPhone([])).toEqual({ inAppRecipientIndex: null, shouldPush: true });
  });
});

describe("woowtechIsPushEligibleAttentionReason (owner 2026-11-14)", () => {
  it("pushes an error as well as a finished agent and a permission request", () => {
    expect(woowtechIsPushEligibleAttentionReason("error")).toBe(true);
    expect(woowtechIsPushEligibleAttentionReason("finished")).toBe(true);
    expect(woowtechIsPushEligibleAttentionReason("permission")).toBe(true);
  });

  it("pushes an error to the phone when nobody is present", () => {
    expect(
      computeNotificationPlan({
        allStates: [
          woowtechClientPresenceState(
            activity({
              deviceType: "web",
              appVisible: false,
              lastActivityAt: new Date(nowMs - 600_000),
            }),
          ),
        ],
        focusTarget: { kind: "agent", id: "agent-1" },
        pushEligible: woowtechIsPushEligibleAttentionReason("error"),
        nowMs,
      }),
    ).toEqual({ inAppRecipientIndex: null, shouldPush: true });
  });

  it("still shows an error only on the present computer, without a push", () => {
    expect(
      computeNotificationPlan({
        allStates: [
          woowtechClientPresenceState(activity({ deviceType: "web", appVisible: false })),
        ],
        focusTarget: { kind: "agent", id: "agent-1" },
        pushEligible: woowtechIsPushEligibleAttentionReason("error"),
        nowMs,
      }),
    ).toEqual({ inAppRecipientIndex: 0, shouldPush: false });
  });
});
