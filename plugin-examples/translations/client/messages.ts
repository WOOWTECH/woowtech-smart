import { defineTranslations } from "@getpaseo/plugin/client";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

export const messages = defineTranslations({ resources: { en, "zh-CN": zhCN, "zh-TW": zhTW } });
