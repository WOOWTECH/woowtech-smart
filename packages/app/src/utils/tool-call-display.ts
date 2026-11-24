import {
  buildToolCallDisplayModel as buildProtocolToolCallDisplayModel,
  type ToolCallDisplayInput,
  type ToolCallDisplayModel,
} from "@getpaseo/protocol/tool-call-display";
import { i18n } from "@/i18n/i18next";

export type { ToolCallDisplayInput, ToolCallDisplayModel };

// woowtech smart: the protocol names a reasoning block "Thinking" in English. In Traditional
// Chinese the timeline shows woowtech.interfaceText.thinking (woowtech/README.md, section 14);
// every other language keeps upstream's name.
export function buildToolCallDisplayModel(input: ToolCallDisplayInput): ToolCallDisplayModel {
  const model = buildProtocolToolCallDisplayModel(input);
  if (
    i18n.language !== "zh-TW" ||
    model.displayName !== "Thinking" ||
    input.name.trim().toLowerCase() !== "thinking"
  ) {
    return model;
  }
  return { ...model, displayName: i18n.t("woowtech.interfaceText.thinking") };
}
