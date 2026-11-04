import { withCliCommand } from "@getpaseo/protocol/brand-cli";
import type { Resource, ResourceKey, ResourceLanguage } from "i18next";
import { APP_NAME, APP_NAME_ZH, withChineseName } from "./product-name";
import { supportCopyFor } from "./support-copy";
import { themeCopyFor } from "./theme-copy";
import { woowtechCopyFor } from "./woowtech-copy";

export { APP_NAME, APP_NAME_ZH };

// Upstream Paseo's name, optionally followed by " Desktop", together with the
// single spaces that set it apart from the text around it.
const UPSTREAM_NAME = /( ?)Paseo( Desktop)?( ?)/g;

function isChinese(language: string): boolean {
  return language === "zh" || language.startsWith("zh-");
}

/**
 * Replaces upstream Paseo's name and command in one translation. `paseo <command>`
 * reads the brand's command (`woowtech-smart <command>`) in every language. Chinese
 * reads the Chinese name ("Paseo Desktop" becomes 渥屋智能桌面版), without the spaces
 * that set the Latin name apart from Chinese text when that name is Chinese; every
 * other language reads the English name. Identifiers such as $PASEO_PORT or
 * paseo.json are left alone.
 */
export function rebrandTranslation(text: string, language: string): string {
  const withCommand = withCliCommand(text);
  if (!isChinese(language)) {
    return withCommand.replaceAll("Paseo", APP_NAME);
  }
  return withChineseName(withCommand, UPSTREAM_NAME);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `tree` with the string at the dotted-key `path` set to `text`. */
function withText(
  tree: Record<string, unknown>,
  path: readonly string[],
  text: string,
): Record<string, unknown> {
  const [key, ...rest] = path;
  if (key === undefined) {
    return tree;
  }
  const child = tree[key];
  return {
    ...tree,
    [key]: rest.length === 0 ? text : withText(isRecord(child) ? child : {}, rest, text),
  };
}

function withSupportCopy(translation: ResourceKey, language: string): ResourceKey {
  if (!isRecord(translation)) {
    return translation;
  }
  return Object.entries({ ...supportCopyFor(language), ...themeCopyFor(language) }).reduce(
    (tree, [key, text]) => withText(tree, key.split("."), text),
    translation,
  );
}

function withWoowtechCopy(translation: ResourceKey, language: string): ResourceKey {
  if (!isRecord(translation)) {
    return translation;
  }
  return { ...translation, woowtech: woowtechCopyFor(language) };
}

/**
 * The translations with the brand's name and command in place of upstream
 * Paseo's, WoowTech's help channels in place of Paseo's Discord and GitHub, the
 * Claude theme called 陶土 (Terracotta), and the fork's own text under `woowtech`.
 * Applied to the resources as they load, so strings upstream adds later are
 * covered without editing its locale files, and interpolated values (a project
 * that happens to be called Paseo) are never touched.
 */
export function rebrandResources(resources: Resource): Resource {
  return Object.fromEntries(
    Object.entries(resources).map(([language, namespaces]): [string, ResourceLanguage] => [
      language,
      Object.fromEntries(
        Object.entries(namespaces).map(([namespace, value]): [string, ResourceKey] => {
          const rebranded = rebrandKey(value, language);
          return [
            namespace,
            namespace === "translation"
              ? withWoowtechCopy(withSupportCopy(rebranded, language), language)
              : rebranded,
          ];
        }),
      ),
    ]),
  );
}
