import { enUS } from "./en-US";
import { zhCN, type TranslationKey } from "./zh-CN";

export type { TranslationKey } from "./zh-CN";

export type Locale = "zh-CN" | "en-US";

const translations: Record<Locale, Record<TranslationKey, string>> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function resolveLocale(browserLanguage: string): Locale {
  return /^zh(?:-|$)/i.test(browserLanguage) ? "zh-CN" : "en-US";
}

function getBrowserLanguage(): string {
  return typeof navigator === "undefined" ? "en-US" : navigator.language;
}

export function isTranslationKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(zhCN, key);
}

export function t(key: TranslationKey): string {
  return translations[resolveLocale(getBrowserLanguage())][key];
}
