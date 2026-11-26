import { findTranslationLanguage } from "../../shared/translation-languages";
import { selectionViewTargetCode, type SelectionTranslationView } from "./selection";

/** The target language shown in a translation popup. */
export function selectionViewTitle(
  view: SelectionTranslationView,
  lang: "en" | "zh" | "zh-TW",
): string {
  const code = selectionViewTargetCode(view);
  const target = code ? findTranslationLanguage(code) : undefined;
  if (!target) return "";
  return lang === "zh-TW" ? target.zhTWName : lang === "zh" ? target.zhName : target.enName;
}
