import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import pt from "./locales/pt.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import zh from "./locales/zh.json";

export const LANGUAGES = [
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      pt: { translation: pt },
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      zh: { translation: zh },
    },
    fallbackLng: "pt",
    supportedLngs: ["pt", "en", "es", "fr", "zh"],
    detection: {
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: "contas_lang",
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
