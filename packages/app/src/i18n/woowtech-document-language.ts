import type { i18n as I18nInstance } from "i18next";

/** woowtech smart: native apps have no document; see woowtech-document-language.web.ts. */
export function followDocumentLanguage(_i18n: Pick<I18nInstance, "language" | "on">): void {}
