import type { AgentOptionControl } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { woowtechLocalizedOptionControls } from "./woowtech-feature-labels";

// Codex option controls returned by codex-feature-definitions.ts.
const CODEX_FEATURES: AgentOptionControl[] = [
  {
    type: "select",
    key: "service_tier",
    label: "Speed",
    description: "Choose processing speed. Faster tiers increase usage.",
    tooltip: "Select speed",
    icon: "zap",
    defaultValue: "default",
    choices: [
      { value: "default", label: "Normal" },
      { value: "priority", label: "Priority" },
    ],
  },
  {
    type: "toggle",
    key: "plan_mode",
    label: "Plan",
    description: "Switch Codex into planning-only collaboration mode",
    tooltip: "Toggle plan mode",
    icon: "list-todo",
    defaultValue: false,
  },
];

describe("feature texts in Traditional Chinese", () => {
  it("names Codex's speed and plan features in Traditional Chinese", () => {
    const [speed, plan] = woowtechLocalizedOptionControls(CODEX_FEATURES, "zh-TW") ?? [];
    expect(speed).toMatchObject({
      key: "service_tier",
      label: "速度",
      tooltip: "選擇速度",
      description: "選擇處理速度。速度越快，用量越高。",
      defaultValue: "default",
    });
    expect(speed?.type === "select" ? speed.choices : []).toEqual([
      { value: "default", label: "一般" },
      { value: "priority", label: "Priority" },
    ]);
    expect(plan).toMatchObject({
      key: "plan_mode",
      label: "計畫",
      tooltip: "切換計畫模式",
      description: "讓 Codex 改成只做規劃的協作模式",
      defaultValue: false,
    });
  });

  it.each(["en", "zh-CN", "ja"])("keeps the daemon's texts in %s", (language) => {
    expect(woowtechLocalizedOptionControls(CODEX_FEATURES, language)).toBe(CODEX_FEATURES);
  });

  it("returns the same array when no text has a translation", () => {
    const features: AgentOptionControl[] = [
      { type: "toggle", key: "fast_mode", label: "Fast mode", defaultValue: false },
    ];
    expect(woowtechLocalizedOptionControls(features, "zh-TW")).toBe(features);
    expect(woowtechLocalizedOptionControls(undefined, "zh-TW")).toBeUndefined();
  });
});
