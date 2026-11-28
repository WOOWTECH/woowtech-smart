import type { AgentOptionControl } from "@getpaseo/protocol/agent-types";

// woowtech smart: the daemon names provider features in English. In Traditional Chinese the
// composer showed Codex's speed control as "Select speed" and "Normal". The texts the daemon
// sends for Codex's speed and plan controls get Traditional Chinese; any other text, and
// every other language, stays the daemon's (woowtech/README.md, section 25).
const ZH_TW_FEATURE_TEXT: Readonly<Record<string, string>> = {
  Speed: "速度",
  "Select speed": "選擇速度",
  "Choose processing speed. Faster tiers increase usage.": "選擇處理速度。速度越快，用量越高。",
  Normal: "一般",
  Plan: "計畫",
  "Toggle plan mode": "切換計畫模式",
  "Switch Codex into planning-only collaboration mode": "讓 Codex 改成只做規劃的協作模式",
};

function zhTwText(text: string): string {
  return ZH_TW_FEATURE_TEXT[text.trim()] ?? text;
}

function zhTwOptionalText(text: string | undefined): string | undefined {
  return text === undefined ? undefined : zhTwText(text);
}

function localizeChoice<T extends { label: string }>(option: T): T {
  const label = zhTwText(option.label);
  return label === option.label ? option : { ...option, label };
}

function localizeControl(feature: AgentOptionControl): AgentOptionControl {
  const label = zhTwText(feature.label);
  const description = zhTwOptionalText(feature.description);
  const tooltip = zhTwOptionalText(feature.tooltip);
  const textChanged =
    label !== feature.label || description !== feature.description || tooltip !== feature.tooltip;
  if (feature.type === "toggle") {
    return textChanged ? { ...feature, label, description, tooltip } : feature;
  }
  const choices = feature.choices.map(localizeChoice);
  const choicesChanged = choices.some((choice, index) => choice !== feature.choices[index]);
  return textChanged || choicesChanged
    ? { ...feature, label, description, tooltip, choices }
    : feature;
}

/**
 * The controls with the daemon's texts in the app's language. Returns the same array when nothing
 * changes, so memoized children do not re-render; keys, choice values, and defaults are never touched.
 */
export function woowtechLocalizedOptionControls(
  features: AgentOptionControl[] | undefined,
  language: string,
): AgentOptionControl[] | undefined {
  if (!features || language !== "zh-TW") {
    return features;
  }
  const localized = features.map(localizeControl);
  return localized.some((feature, index) => feature !== features[index]) ? localized : features;
}
