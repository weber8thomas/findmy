import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en, { type MessageKey } from "./en";
import fr from "./fr";

export type Locale = "en" | "fr";
const catalogues = { en, fr } as const;
const STORAGE_KEY = "locus.locale";

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>) {
  return format(catalogues[locale][key] ?? en[key] ?? key, params);
}

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    /* storage unavailable */
  }
  const lang = typeof navigator === "undefined" ? "" : navigator.language;
  return lang?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

type I18n = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  relTime: (iso: string | number | Date | null | undefined) => string;
  dateTime: (iso: string | Date) => string;
  distance: (meters: number) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale());

  // Screen readers pick their voice from <html lang>, including on the first load.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    return {
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      relTime: (input) => {
        if (input == null) return translate(locale, "common.never");
        const ms = new Date(input).getTime() - Date.now();
        const abs = Math.abs(ms);
        if (abs < 45_000) return translate(locale, "common.now");
        if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), "minute");
        if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), "hour");
        return rtf.format(Math.round(ms / 86_400_000), "day");
      },
      dateTime: (iso) => dtf.format(new Date(iso)),
      distance: (m) => (m < 1000 ? `${Math.round(m)} m` : `${nf.format(m / 1000)} km`),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
