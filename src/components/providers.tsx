"use client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createInstance, type i18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { useEffect, useState, type ReactNode } from "react";
import english from "../../public/locales/en.json";
import { englishGuidedSettingTranslations } from "@/lib/localization-resources";
import { ThemeProvider } from "./theme-provider";

function LiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const stream = new EventSource("/api/events");
    const refresh = () => { void client.invalidateQueries({ queryKey: ["worlds"] }); void client.invalidateQueries({ queryKey: ["jobs"] }); };
    stream.addEventListener("world", refresh); stream.addEventListener("job", refresh);
    return () => stream.close();
  }, [client]);
  return null;
}

function LanguageLoader({ instance }: { instance: i18n }) {
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/i18n/current").then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const code = body.pack.meta.code as string;
      if (code === "en" || cancelled) return;
      instance.addResourceBundle(code, "translation", body.pack.translations, true, true);
      await instance.changeLanguage(code);
      document.documentElement.lang = code;
      document.documentElement.dir = body.pack.meta.direction;
    }).catch((error) => console.warn("Could not load the configured language pack", error));
    return () => { cancelled = true; };
  }, [instance]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, refetchInterval: 10_000, retry: 1 } } }));
  const [localization] = useState(() => {
    const instance = createInstance();
    void instance.use(initReactI18next).init({ lng: "en", fallbackLng: "en", resources: { en: { translation: { ...english.translations, ...englishGuidedSettingTranslations() } } }, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false }, react: { useSuspense: false }, initAsync: false });
    return instance;
  });
  return <ThemeProvider><I18nextProvider i18n={localization}><QueryClientProvider client={client}><LanguageLoader instance={localization} /><LiveUpdates />{children}</QueryClientProvider></I18nextProvider></ThemeProvider>;
}
