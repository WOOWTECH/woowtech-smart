/**
 * Target language catalog for timeline translation.
 *
 * Includes the 118 target language entries from Immersive Translate's language
 * list (excluding auto-detect) plus the leading "interface" option that follows
 * the active Better Paseo interface language.
 *
 * Keep comments and regexes strictly ASCII for Hermes bundle compilation.
 */

export interface TranslationLanguageEntry {
  readonly code: string;
  readonly zhName: string;
  readonly zhTWName: string;
  readonly enName: string;
  readonly nativeName: string;
}

export const FOLLOW_INTERFACE_LANGUAGE_CODE = "interface";

export const TRANSLATION_LANGUAGES: readonly TranslationLanguageEntry[] = [
  {
    code: "interface",
    zhName: "跟随界面语言",
    zhTWName: "跟隨界面語言",
    enName: "Follow interface language",
    nativeName: "Follow interface language",
  },
  {
    code: "af",
    zhName: "阿非利卡语",
    zhTWName: "阿非利卡語",
    enName: "Afrikaans",
    nativeName: "Afrikaans",
  },
  {
    code: "am",
    zhName: "阿姆哈拉语",
    zhTWName: "阿姆哈拉語",
    enName: "Amharic",
    nativeName: "Amharic",
  },
  { code: "ar", zhName: "阿拉伯语", zhTWName: "阿拉伯語", enName: "Arabic", nativeName: "Arabic" },
  {
    code: "az",
    zhName: "阿塞拜疆语",
    zhTWName: "阿塞拜疆語",
    enName: "Azerbaijani",
    nativeName: "Azerbaijani",
  },
  {
    code: "be",
    zhName: "白俄罗斯语",
    zhTWName: "白俄羅斯語",
    enName: "Belarusian",
    nativeName: "Belarusian",
  },
  {
    code: "bg",
    zhName: "保加利亚语",
    zhTWName: "保加利亞語",
    enName: "Bulgarian",
    nativeName: "Bulgarian",
  },
  { code: "tn", zhName: "泽纳语", zhTWName: "澤納語", enName: "Zana", nativeName: "Zana" },
  {
    code: "bn",
    zhName: "孟加拉语",
    zhTWName: "孟加拉語",
    enName: "Bengali",
    nativeName: "Bengali",
  },
  {
    code: "bs",
    zhName: "波斯尼亚语",
    zhTWName: "波斯尼亞語",
    enName: "Bosnian",
    nativeName: "Bosnian",
  },
  {
    code: "ca",
    zhName: "加泰罗尼亚语",
    zhTWName: "加泰羅尼亞語",
    enName: "Catalan",
    nativeName: "Catalan",
  },
  { code: "ceb", zhName: "宿务语", zhTWName: "宿務語", enName: "Cebuano", nativeName: "Cebuano" },
  {
    code: "co",
    zhName: "科西嘉语",
    zhTWName: "科西嘉語",
    enName: "Corsican",
    nativeName: "Corsican",
  },
  { code: "cs", zhName: "捷克语", zhTWName: "捷克語", enName: "Czech", nativeName: "Czech" },
  { code: "cy", zhName: "威尔士语", zhTWName: "威爾士語", enName: "Welsh", nativeName: "Welsh" },
  { code: "da", zhName: "丹麦语", zhTWName: "丹麥語", enName: "Danish", nativeName: "Danish" },
  { code: "de", zhName: "德语", zhTWName: "德語", enName: "German", nativeName: "German" },
  { code: "el", zhName: "希腊语", zhTWName: "希臘語", enName: "Greek", nativeName: "Greek" },
  { code: "en", zhName: "英语", zhTWName: "英語", enName: "English", nativeName: "English" },
  {
    code: "eo",
    zhName: "世界语",
    zhTWName: "世界語",
    enName: "Esperanto",
    nativeName: "Esperanto",
  },
  {
    code: "es",
    zhName: "西班牙语",
    zhTWName: "西班牙語",
    enName: "Spanish",
    nativeName: "Spanish",
  },
  {
    code: "et",
    zhName: "爱沙尼亚语",
    zhTWName: "愛沙尼亞語",
    enName: "Estonian",
    nativeName: "Estonian",
  },
  { code: "eu", zhName: "巴斯克语", zhTWName: "巴斯克語", enName: "Basque", nativeName: "Basque" },
  { code: "fa", zhName: "波斯语", zhTWName: "波斯語", enName: "Farsi", nativeName: "Farsi" },
  { code: "fi", zhName: "芬兰语", zhTWName: "芬蘭語", enName: "Finnish", nativeName: "Finnish" },
  {
    code: "fil",
    zhName: "菲律宾语",
    zhTWName: "菲律賓語",
    enName: "Filipino",
    nativeName: "Filipino",
  },
  { code: "fj", zhName: "斐济语", zhTWName: "斐濟語", enName: "Fijian", nativeName: "Fijian" },
  { code: "fr", zhName: "法语", zhTWName: "法語", enName: "French", nativeName: "French" },
  {
    code: "fy",
    zhName: "弗里斯兰语",
    zhTWName: "弗里斯蘭語",
    enName: "Frisian",
    nativeName: "Frisian",
  },
  { code: "ga", zhName: "爱尔兰语", zhTWName: "愛爾蘭語", enName: "Irish", nativeName: "Irish" },
  {
    code: "gd",
    zhName: "苏格兰盖尔语",
    zhTWName: "蘇格蘭蓋爾語",
    enName: "Scottish Gaelic",
    nativeName: "Scottish Gaelic",
  },
  {
    code: "gl",
    zhName: "加利西亚语",
    zhTWName: "加利西亞語",
    enName: "Galician",
    nativeName: "Galician",
  },
  {
    code: "gu",
    zhName: "古吉拉特语",
    zhTWName: "古吉拉特語",
    enName: "Gujarati",
    nativeName: "Gujarati",
  },
  { code: "ha", zhName: "豪萨语", zhTWName: "豪薩語", enName: "Hausa", nativeName: "Hausa" },
  {
    code: "haw",
    zhName: "夏威夷语",
    zhTWName: "夏威夷語",
    enName: "Hawaiian",
    nativeName: "Hawaiian",
  },
  { code: "he", zhName: "希伯来语", zhTWName: "希伯來語", enName: "Hebrew", nativeName: "Hebrew" },
  { code: "hi", zhName: "印地语", zhTWName: "印地語", enName: "Hindi", nativeName: "Hindi" },
  { code: "hmn", zhName: "蒙语", zhTWName: "蒙語", enName: "Hmong", nativeName: "Hmong" },
  {
    code: "hr",
    zhName: "克罗地亚语",
    zhTWName: "克羅地亞語",
    enName: "Croatian",
    nativeName: "Croatian",
  },
  {
    code: "ht",
    zhName: "海地克里奥尔语",
    zhTWName: "海地克里奧爾語",
    enName: "Haitian Creole",
    nativeName: "Haitian Creole",
  },
  {
    code: "hu",
    zhName: "匈牙利语",
    zhTWName: "匈牙利語",
    enName: "Hungarian",
    nativeName: "Hungarian",
  },
  {
    code: "hy",
    zhName: "亚美尼亚语",
    zhTWName: "亞美尼亞語",
    enName: "Armenian",
    nativeName: "Armenian",
  },
  {
    code: "id",
    zhName: "印度尼西亚语",
    zhTWName: "印度尼西亞語",
    enName: "Indonesian",
    nativeName: "Indonesian",
  },
  { code: "ig", zhName: "伊博语", zhTWName: "伊博語", enName: "Igbo", nativeName: "Igbo" },
  {
    code: "is",
    zhName: "冰岛语",
    zhTWName: "冰島語",
    enName: "Icelandic",
    nativeName: "Icelandic",
  },
  {
    code: "it",
    zhName: "意大利语",
    zhTWName: "意大利語",
    enName: "Italian",
    nativeName: "Italian",
  },
  { code: "ja", zhName: "日本语", zhTWName: "日本語", enName: "Japanese", nativeName: "日本語" },
  { code: "jw", zhName: "爪哇语", zhTWName: "爪哇語", enName: "Javanese", nativeName: "Javanese" },
  {
    code: "ka",
    zhName: "格鲁吉亚语",
    zhTWName: "格魯吉亞語",
    enName: "Georgian",
    nativeName: "Georgian",
  },
  { code: "kk", zhName: "哈萨克语", zhTWName: "哈薩克語", enName: "Kazakh", nativeName: "Kazakh" },
  { code: "km", zhName: "高棉语", zhTWName: "高棉語", enName: "Khmer", nativeName: "Khmer" },
  {
    code: "kn",
    zhName: "卡纳达语",
    zhTWName: "卡納達語",
    enName: "Kannada",
    nativeName: "Kannada",
  },
  { code: "ko", zhName: "韩语", zhTWName: "韓語", enName: "Korean", nativeName: "Korean" },
  {
    code: "ku",
    zhName: "库尔德语",
    zhTWName: "庫爾德語",
    enName: "Kurdish",
    nativeName: "Kurdish",
  },
  {
    code: "ky",
    zhName: "吉尔吉斯语",
    zhTWName: "吉爾吉斯語",
    enName: "Kyrgyz",
    nativeName: "Kyrgyz",
  },
  { code: "la", zhName: "拉丁语", zhTWName: "拉丁語", enName: "Latin", nativeName: "Latin" },
  {
    code: "lb",
    zhName: "卢森堡语",
    zhTWName: "盧森堡語",
    enName: "Luxembourgish",
    nativeName: "Luxembourgish",
  },
  { code: "lo", zhName: "老挝语", zhTWName: "老撾語", enName: "Lao", nativeName: "Lao" },
  {
    code: "lt",
    zhName: "立陶宛语",
    zhTWName: "立陶宛語",
    enName: "Lithuanian",
    nativeName: "Lithuanian",
  },
  {
    code: "lv",
    zhName: "拉脱维亚语",
    zhTWName: "拉脫維亞語",
    enName: "Latvian",
    nativeName: "Latvian",
  },
  {
    code: "mg",
    zhName: "马尔加什语",
    zhTWName: "馬爾加什語",
    enName: "Malagash",
    nativeName: "Malagash",
  },
  { code: "mi", zhName: "毛利语", zhTWName: "毛利語", enName: "Maori", nativeName: "Maori" },
  {
    code: "mk",
    zhName: "马其顿语",
    zhTWName: "馬其頓語",
    enName: "Macedonian",
    nativeName: "Macedonian",
  },
  {
    code: "ml",
    zhName: "马拉雅拉姆语",
    zhTWName: "馬拉雅拉姆語",
    enName: "Malayalam",
    nativeName: "Malayalam",
  },
  {
    code: "mn",
    zhName: "蒙古语",
    zhTWName: "蒙古語",
    enName: "Mongolian",
    nativeName: "Mongolian",
  },
  {
    code: "mr",
    zhName: "马拉地语",
    zhTWName: "馬拉地語",
    enName: "Marathi",
    nativeName: "Marathi",
  },
  { code: "ms", zhName: "马来语", zhTWName: "馬來語", enName: "Malay", nativeName: "Malay" },
  {
    code: "mt",
    zhName: "马耳他语",
    zhTWName: "馬耳他語",
    enName: "Maltese",
    nativeName: "Maltese",
  },
  { code: "mww", zhName: "白苗语", zhTWName: "白苗語", enName: "Bai Miao", nativeName: "Bai Miao" },
  { code: "my", zhName: "缅甸语", zhTWName: "緬甸語", enName: "Burmese", nativeName: "Burmese" },
  { code: "ne", zhName: "尼泊尔语", zhTWName: "尼泊爾語", enName: "Nepali", nativeName: "Nepali" },
  { code: "nl", zhName: "荷兰语", zhTWName: "荷蘭語", enName: "Dutch", nativeName: "Dutch" },
  {
    code: "no",
    zhName: "挪威语",
    zhTWName: "挪威語",
    enName: "Norwegian",
    nativeName: "Norwegian",
  },
  {
    code: "ny",
    zhName: "奇切瓦语",
    zhTWName: "奇切瓦語",
    enName: "Nyanza (Chichewa)",
    nativeName: "Nyanza (Chichewa)",
  },
  {
    code: "otq",
    zhName: "奥托米语",
    zhTWName: "奧托米語",
    enName: "Querétaro Otomi",
    nativeName: "Querétaro Otomi",
  },
  {
    code: "pa",
    zhName: "旁遮普语",
    zhTWName: "旁遮普語",
    enName: "Punjabi",
    nativeName: "Punjabi",
  },
  { code: "pl", zhName: "波兰语", zhTWName: "波蘭語", enName: "Polish", nativeName: "Polish" },
  {
    code: "ps",
    zhName: "阿富汗/普什图语",
    zhTWName: "阿富汗/普什圖語",
    enName: "Afghan/Pashto",
    nativeName: "Afghan/Pashto",
  },
  {
    code: "pt",
    zhName: "葡萄牙语",
    zhTWName: "葡萄牙語",
    enName: "Portuguese (Portugal, Brazil)",
    nativeName: "Portuguese (Portugal, Brazil)",
  },
  {
    code: "ro",
    zhName: "罗马尼亚语",
    zhTWName: "羅馬尼亞語",
    enName: "Romanian",
    nativeName: "Romanian",
  },
  {
    code: "ru",
    zhName: "俄罗斯语",
    zhTWName: "俄羅斯語",
    enName: "Russian",
    nativeName: "Russian",
  },
  { code: "sd", zhName: "信德语", zhTWName: "信德語", enName: "Sindhi", nativeName: "Sindhi" },
  {
    code: "si",
    zhName: "僧伽罗语",
    zhTWName: "僧伽羅語",
    enName: "Sinhala",
    nativeName: "Sinhala",
  },
  {
    code: "sk",
    zhName: "斯洛伐克语",
    zhTWName: "斯洛伐克語",
    enName: "Slovak",
    nativeName: "Slovak",
  },
  {
    code: "sl",
    zhName: "斯洛文尼亚语",
    zhTWName: "斯洛文尼亞語",
    enName: "Slovenian",
    nativeName: "Slovenian",
  },
  { code: "sm", zhName: "萨摩亚语", zhTWName: "薩摩亞語", enName: "Samoan", nativeName: "Samoan" },
  { code: "sn", zhName: "修纳语", zhTWName: "修納語", enName: "Shona", nativeName: "Shona" },
  { code: "so", zhName: "索马里语", zhTWName: "索馬里語", enName: "Somali", nativeName: "Somali" },
  {
    code: "sq",
    zhName: "阿尔巴尼亚语",
    zhTWName: "阿爾巴尼亞語",
    enName: "Albanian",
    nativeName: "Albanian",
  },
  {
    code: "sr",
    zhName: "塞尔维亚语",
    zhTWName: "塞爾維亞語",
    enName: "Serbian",
    nativeName: "Serbian",
  },
  {
    code: "sr-Cyrl",
    zhName: "塞尔维亚语（西里尔文）",
    zhTWName: "塞爾維亞語（西里爾文）",
    enName: "Serbian (Cyrillic)",
    nativeName: "Serbian (Cyrillic)",
  },
  {
    code: "sr-Latn",
    zhName: "塞尔维亚语（拉丁文）",
    zhTWName: "塞爾維亞語（拉丁文）",
    enName: "Serbian (Latin)",
    nativeName: "Serbian (Latin)",
  },
  {
    code: "st",
    zhName: "塞索托语",
    zhTWName: "塞索托語",
    enName: "Sesotho",
    nativeName: "Sesotho",
  },
  {
    code: "su",
    zhName: "巽他语",
    zhTWName: "巽他語",
    enName: "Sundanese",
    nativeName: "Sundanese",
  },
  { code: "sv", zhName: "瑞典语", zhTWName: "瑞典語", enName: "Swedish", nativeName: "Swedish" },
  {
    code: "sw",
    zhName: "斯瓦希里语",
    zhTWName: "斯瓦希里語",
    enName: "Swahili",
    nativeName: "Swahili",
  },
  { code: "ta", zhName: "泰米尔语", zhTWName: "泰米爾語", enName: "Tamil", nativeName: "Tamil" },
  { code: "te", zhName: "泰卢固语", zhTWName: "泰盧固語", enName: "Telugu", nativeName: "Telugu" },
  { code: "tg", zhName: "塔吉克语", zhTWName: "塔吉克語", enName: "Tajik", nativeName: "Tajik" },
  { code: "th", zhName: "泰语", zhTWName: "泰語", enName: "Thai", nativeName: "Thai" },
  {
    code: "tlh",
    zhName: "克林贡语",
    zhTWName: "克林貢語",
    enName: "Klingon",
    nativeName: "Klingon",
  },
  {
    code: "tlh-Qaak",
    zhName: "克林贡语（piqaD）",
    zhTWName: "克林貢語（piqaD）",
    enName: "Klingon (piqaD)",
    nativeName: "Klingon (piqaD)",
  },
  { code: "to", zhName: "汤加语", zhTWName: "湯加語", enName: "Tongan", nativeName: "Tongan" },
  {
    code: "tr",
    zhName: "土耳其语",
    zhTWName: "土耳其語",
    enName: "Turkish",
    nativeName: "Turkish",
  },
  { code: "ty", zhName: "塔希提语", zhTWName: "塔希提語", enName: "Tahiti", nativeName: "Tahiti" },
  { code: "ug", zhName: "维吾尔语", zhTWName: "維吾爾語", enName: "Uyghur", nativeName: "Uyghur" },
  {
    code: "uk",
    zhName: "乌克兰语",
    zhTWName: "烏克蘭語",
    enName: "Ukrainian",
    nativeName: "Ukrainian",
  },
  { code: "ur", zhName: "乌尔都语", zhTWName: "烏爾都語", enName: "Urdu", nativeName: "Urdu" },
  {
    code: "uz",
    zhName: "乌兹别克语",
    zhTWName: "烏茲別克語",
    enName: "Uzbek",
    nativeName: "Uzbek",
  },
  {
    code: "vi",
    zhName: "越南语",
    zhTWName: "越南語",
    enName: "Vietnamese",
    nativeName: "Vietnamese",
  },
  {
    code: "wyw",
    zhName: "文言文",
    zhTWName: "文言文",
    enName: "Classical Chinese",
    nativeName: "文言文",
  },
  { code: "xh", zhName: "班图语", zhTWName: "班圖語", enName: "Bantu", nativeName: "Bantu" },
  {
    code: "yi",
    zhName: "意第绪语",
    zhTWName: "意第緒語",
    enName: "Yiddish",
    nativeName: "Yiddish",
  },
  { code: "yo", zhName: "约鲁巴语", zhTWName: "約魯巴語", enName: "Yoruba", nativeName: "Yoruba" },
  {
    code: "yua",
    zhName: "尤卡坦玛雅语",
    zhTWName: "尤卡坦瑪雅語",
    enName: "Yucatan Mayan",
    nativeName: "Yucatan Mayan",
  },
  {
    code: "yue",
    zhName: "广东话（传统）",
    zhTWName: "廣東話（傳統）",
    enName: "Cantonese (Traditional)",
    nativeName: "Cantonese (Traditional)",
  },
  {
    code: "zh-CN",
    zhName: "简体中文",
    zhTWName: "簡體中文",
    enName: "Simplified Chinese",
    nativeName: "简体中文",
  },
  {
    code: "zh-TW",
    zhName: "繁体中文",
    zhTWName: "繁體中文",
    enName: "Traditional Chinese",
    nativeName: "繁體中文",
  },
  { code: "zu", zhName: "祖鲁语", zhTWName: "祖魯語", enName: "Zulu", nativeName: "Zulu" },
];

const BY_CODE = new Map<string, TranslationLanguageEntry>(
  TRANSLATION_LANGUAGES.map((entry) => [entry.code, entry]),
);

export function isTranslationLanguageCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function findTranslationLanguage(code: string): TranslationLanguageEntry | undefined {
  return BY_CODE.get(code);
}

export function formatTranslationLanguageLabel(
  entry: TranslationLanguageEntry,
  uiLanguage: "en" | "zh" | "zh-TW",
): string {
  const name =
    uiLanguage === "zh-TW" ? entry.zhTWName : uiLanguage === "zh" ? entry.zhName : entry.enName;
  if (entry.code === FOLLOW_INTERFACE_LANGUAGE_CODE || name === entry.nativeName) return name;
  return `${name} \u00B7 ${entry.nativeName}`;
}

export function filterTranslationLanguages(query: string): readonly TranslationLanguageEntry[] {
  const term = query.trim().toLowerCase();
  if (!term) return TRANSLATION_LANGUAGES;
  return TRANSLATION_LANGUAGES.filter(
    (entry) =>
      entry.code.toLowerCase().includes(term) ||
      entry.zhName.toLowerCase().includes(term) ||
      entry.zhTWName.toLowerCase().includes(term) ||
      entry.enName.toLowerCase().includes(term) ||
      entry.nativeName.toLowerCase().includes(term),
  );
}

export interface ResolvedTranslationTarget {
  code: string;
  entry: TranslationLanguageEntry;
  /** Human-readable target description included in the translation prompt. */
  promptTarget: string;
}

export function resolveTranslationTarget(
  configuredCode: string,
  interfaceLanguage: "en" | "zh" | "zh-TW",
): ResolvedTranslationTarget {
  const interfaceCode =
    interfaceLanguage === "zh-TW" ? "zh-TW" : interfaceLanguage === "zh" ? "zh-CN" : "en";
  const effectiveCode =
    configuredCode === FOLLOW_INTERFACE_LANGUAGE_CODE ? interfaceCode : configuredCode;
  const entry = BY_CODE.get(effectiveCode) ?? BY_CODE.get(interfaceCode)!;
  const promptTarget =
    entry.enName === entry.nativeName
      ? `${entry.enName} (${entry.code})`
      : `${entry.enName} / ${entry.nativeName} (${entry.code})`;
  return { code: entry.code, entry, promptTarget };
}
