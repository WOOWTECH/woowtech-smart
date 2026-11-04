import type { AgentPermissionAction } from "@getpaseo/protocol/agent-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { localizePermissionActions } from "./woowtech-permission-actions";

// What Claude sends for a plan (providers/claude/agent.ts, buildClaudePlanPermissionActions),
// with the resume button it adds when the agent was in bypass mode; Codex's dismiss is "Dismiss".
const CLAUDE_PLAN: AgentPermissionAction[] = [
  { id: "reject", label: "Reject", behavior: "deny", variant: "danger", intent: "dismiss" },
  {
    id: "implement",
    label: "Implement",
    behavior: "allow",
    variant: "primary",
    intent: "implement",
  },
  {
    id: "implement_resume",
    label: "Implement with Bypass",
    behavior: "allow",
    variant: "secondary",
    intent: "implement_resume",
  },
];

function labels(language: string, actions: AgentPermissionAction[] = CLAUDE_PLAN): string[] {
  return localizePermissionActions(actions, i18n.getFixedT(language), language).map(
    (action) => action.label,
  );
}

describe("localizePermissionActions", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("puts the plan buttons in Traditional Chinese", () => {
    expect(labels("zh-TW")).toEqual(["拒絕", "實作", "以「Bypass」實作"]);
  });

  it("keeps the provider's English wording in English", () => {
    expect(labels("en")).toEqual(["Reject", "Implement", "Implement with Bypass"]);
  });

  it("keeps everything else as the provider sent it", () => {
    const other: AgentPermissionAction[] = [
      { id: "always", label: "Always allow", behavior: "allow", variant: "secondary" },
      {
        id: "implement_resume",
        label: "Resume in Full Access",
        behavior: "allow",
        variant: "secondary",
        intent: "implement_resume",
      },
    ];
    expect(labels("zh-TW", other)).toEqual(["Always allow", "Resume in Full Access"]);
  });

  it("does not change the actions it was given", () => {
    const actions = structuredClone(CLAUDE_PLAN);
    localizePermissionActions(actions, i18n.getFixedT("zh-TW"), "zh-TW");
    expect(actions).toEqual(CLAUDE_PLAN);
  });
});
