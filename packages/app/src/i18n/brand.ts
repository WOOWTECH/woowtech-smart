import type { Resource, ResourceKey, ResourceLanguage } from "i18next";

/** The product name wherever the UI is not in Chinese. */
export const APP_NAME = "woowtech smart";
/** The product name in Chinese UI. */
export const APP_NAME_ZH = "渥屋智能";

// Upstream Paseo's name, optionally followed by " Desktop", together with the
// single spaces that set it apart from the text around it.
const UPSTREAM_NAME = /( ?)Paseo( Desktop)?( ?)/g;
const CJK_CHARACTER = /[　-〿㐀-鿿＀-￯]/;

function isChinese(language: string): boolean {
  return language === "zh" || language.startsWith("zh-");
}

/** Keeps a separating space only where the neighbouring text is not Chinese. */
function spaceBeside(space: string, neighbour: string | undefined): string {
  return space && neighbour && !CJK_CHARACTER.test(neighbour) ? space : "";
}

/**
 * Replaces upstream Paseo's name in one translation. Chinese reads 渥屋智能
 * ("Paseo Desktop" becomes 渥屋智能桌面版) without the spaces that set the Latin
 * name apart from Chinese text; every other language reads "woowtech smart".
 * Identifiers such as $PASEO_PORT or paseo.json are left alone.
 */
export function rebrandTranslation(text: string, language: string): string {
  if (!isChinese(language)) {
    return text.replaceAll("Paseo", APP_NAME);
  }
  return text.replace(
    UPSTREAM_NAME,
    (match: string, before: string, desktop: string | undefined, after: string, offset: number) => {
      const name = desktop ? `${APP_NAME_ZH}桌面版` : APP_NAME_ZH;
      const leading = spaceBeside(before, text[offset - 1]);
      const trailing = spaceBeside(after, text[offset + match.length]);
      return `${leading}${name}${trailing}`;
    },
  );
}

function rebrandValue(value: unknown, language: string): unknown {
  if (typeof value === "string") {
    return rebrandTranslation(value, language);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rebrandValue(item, language));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]): [string, unknown] => [
        key,
        rebrandValue(child, language),
      ]),
    );
  }
  return value;
}

function rebrandKey(value: ResourceKey, language: string): ResourceKey {
  if (typeof value === "string") {
    return rebrandTranslation(value, language);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]): [string, unknown] => [
      key,
      rebrandValue(child, language),
    ]),
  );
}

/**
 * The translations with woowtech smart's name in place of upstream Paseo's.
 * Applied to the resources as they load, so strings upstream adds later are
 * covered without editing its locale files, and interpolated values (a project
 * that happens to be called Paseo) are never touched.
 */
export function rebrandResources(resources: Resource): Resource {
  return Object.fromEntries(
    Object.entries(resources).map(([language, namespaces]): [string, ResourceLanguage] => [
      language,
      Object.fromEntries(
        Object.entries(namespaces).map(([namespace, value]): [string, ResourceKey] => [
          namespace,
          rebrandKey(value, language),
        ]),
      ),
    ]),
  );
}
