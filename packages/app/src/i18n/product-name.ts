import {
  PRODUCT_DESKTOP_NAME_ZH,
  PRODUCT_NAME,
  PRODUCT_NAME_ZH,
} from "@getpaseo/protocol/brand-name";

/** The product name wherever the UI is not in Chinese. */
export const APP_NAME = PRODUCT_NAME;
/** The product name in Chinese UI: 渥屋智能. Apporo smart has no Chinese name, so it is APP_NAME. */
export const APP_NAME_ZH = PRODUCT_NAME_ZH;

const CJK_CHARACTER = /[　-〿㐀-鿿＀-￯]/;
// The fork's own text (woowtech-copy.ts) writes the product name as a token: {productName} is
// the English name in any language, {productNameZh} the Chinese name, written with the spaces
// a Latin name takes beside Chinese text.
const PRODUCT_NAME_TOKEN = "{productName}";
const CHINESE_NAME_TOKEN = /( ?)\{productNameZh\}()( ?)/g;

/**
 * Keeps a separating space unless both sides of it are Chinese: the neighbouring text and the
 * end of the name beside it. So 渥屋智能 loses the spaces a Latin name had beside Chinese text,
 * and Apporo smart keeps them.
 */
function spaceBeside(space: string, neighbour: string | undefined, nameEnd: string): string {
  if (!space || !neighbour) {
    return "";
  }
  return CJK_CHARACTER.test(neighbour) && CJK_CHARACTER.test(nameEnd) ? "" : space;
}

/**
 * `text` with every match of `pattern` written as the Chinese name. The pattern's groups are the
 * space before, an optional " Desktop" (渥屋智能桌面版) and the space after.
 */
export function withChineseName(text: string, pattern: RegExp): string {
  return text.replace(
    pattern,
    (match: string, before: string, desktop: string | undefined, after: string, offset: number) => {
      const name = desktop ? PRODUCT_DESKTOP_NAME_ZH : APP_NAME_ZH;
      const leading = spaceBeside(before, text[offset - 1], name[0] ?? "");
      const trailing = spaceBeside(after, text[offset + match.length], name[name.length - 1] ?? "");
      return `${leading}${name}${trailing}`;
    },
  );
}

/** One string of the fork's own text with its name tokens written as the brand's names. */
export function withProductName(text: string): string {
  return withChineseName(text.replaceAll(PRODUCT_NAME_TOKEN, APP_NAME), CHINESE_NAME_TOKEN);
}

/** `value` with every string in it passed through withProductName. */
export function withProductNames<T>(value: T): T {
  if (typeof value === "string") {
    return withProductName(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => withProductNames(item)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, withProductNames(child)]),
    ) as T;
  }
  return value;
}
