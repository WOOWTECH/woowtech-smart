import { createInstance, type BackendModule, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import { rebrandResources } from "./brand";
import { followDocumentLanguage } from "./woowtech-document-language";
import { observeI18nInit } from "./init";
import { en } from "./resources/en";

// Literal requires keep every locale bundled for offline use, while evaluating
// its resource module only when selected. Synchronous reads preserve the language
// provider's contract: translations are ready before it renders children.
const bundledTranslations: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const receive = (translation: ResourceKey) =>
      callback(null, rebrandResources({ [language]: { translation } })[language].translation);
    switch (language) {
      case "en":
        receive(en);
        return;
      case "ar":
        receive(require("./resources/ar").ar);
        return;
      case "es":
        receive(require("./resources/es").es);
        return;
      case "fr":
        receive(require("./resources/fr").fr);
        return;
      case "ja":
        receive(require("./resources/ja").ja);
        return;
      case "ko":
        receive(require("./resources/ko").ko);
        return;
      case "pt-BR":
        receive(require("./resources/pt-BR").ptBR);
        return;
      case "ru":
        receive(require("./resources/ru").ru);
        return;
      case "zh-CN":
        receive(require("./resources/zh-CN").zhCN);
        return;
      case "zh-TW":
        receive(require("./resources/zh-TW").zhTW);
        return;
      default:
        callback(null, undefined);
    }
  },
};

const i18n = createInstance();

observeI18nInit(
  i18n
    .use(bundledTranslations)
    .use(initReactI18next)
    .init({
      compatibilityJSON: "v4",
      fallbackLng: "en",
      lng: "en",
      partialBundledLanguages: true,
      resources: rebrandResources({
        en: { translation: en },
      }),
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    }),
);
followDocumentLanguage(i18n);

export { i18n };
