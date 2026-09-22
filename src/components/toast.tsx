"use client";
import { useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";

export function Toast({ message, onDismiss, duration = 6_000 }: { message: string | null; onDismiss(): void; duration?: number }) {
  const { t } = useTranslation();
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(dismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message]);
  if (!message) return null;
  return <div className="toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label={t("common.dismissNotification")} onClick={onDismiss}>×</button></div>;
}
