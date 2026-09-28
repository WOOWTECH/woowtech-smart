import type { i18n as I18nInstance } from "i18next";

/**
 * woowtech smart: keeps <html lang> on the app language. Expo's web template fixes it at "en",
 * so browsers and Electron drew Chinese text with the default CJK font for English pages and
 * screen readers read it as English.
 */
export function followDocumentLanguage(
  i18n: Pick<I18nInstance, "language" | "on">,
  // The unit tests resolve .web files too, and run without a document.
  root: { lang: string } | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  if (!root) return;
  const apply = (language: string | undefined): void => {
    if (language) root.lang = language;
  };
  apply(i18n.language);
  i18n.on("languageChanged", apply);
}
