import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { woowtechLocalizedFeatures } from "./woowtech-feature-labels";

// The features the Paseo 0.11.2 daemon sends for Codex (codex-feature-definitions.js).
const CODEX_FEATURES: AgentFeature[] = [
  {
    type: "select",
    id: "service_tier",
    label: "Speed",
    description: "Choose processing speed. Faster tiers increase usage.",
    tooltip: "Select speed",
    icon: "zap",
    value: null,
    options: [
      { id: "default", label: "Normal", isDefault: true },
      { id: "priority", label: "Priority" },
    ],
  },
  {
    type: "toggle",
    id: "plan_mode",
    label: "Plan",
    description: "Switch Codex into planning-only collaboration mode",
    tooltip: "Toggle plan mode",
    icon: "list-todo",
    value: false,
  },
];

describe("feature texts in Traditional Chinese", () => {
  it("names Codex's speed and plan features in Traditional Chinese", () => {
    const [speed, plan] = woowtechLocalizedFeatures(CODEX_FEATURES, "zh-TW") ?? [];
    expect(speed).toMatchObject({
      id: "service_tier",
      label: "速度",
      tooltip: "選擇速度",
      description: "選擇處理速度。速度越快，用量越高。",
      value: null,
    });
    expect(speed?.type === "select" ? speed.options : []).toEqual([
      { id: "default", label: "一般", isDefault: true },
      { id: "priority", label: "Priority" },
    ]);
    expect(plan).toMatchObject({
      id: "plan_mode",
      label: "計畫",
      tooltip: "切換計畫模式",
      description: "讓 Codex 改成只做規劃的協作模式",
      value: false,
    });
  });

  it("keeps the daemon's texts in English", () => {
    expect(woowtechLocalizedFeatures(CODEX_FEATURES, "en")).toBe(CODEX_FEATURES);
  });

  it("returns the same array when no text has a translation", () => {
    const features: AgentFeature[] = [
      { type: "toggle", id: "fast_mode", label: "Fast mode", value: false },
    ];
    expect(woowtechLocalizedFeatures(features, "zh-TW")).toBe(features);
    expect(woowtechLocalizedFeatures(undefined, "zh-TW")).toBeUndefined();
  });
});
