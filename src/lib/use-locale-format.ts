"use client";
import { useTranslation } from "react-i18next";

export function useLocaleDateTime() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return (value: number | Date) => new Date(value).toLocaleString(language);
}
