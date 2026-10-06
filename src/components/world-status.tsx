"use client";
import { useTranslation } from "react-i18next";
import type { WorldStatus as WorldStatusValue } from "@/contracts/world";

export function WorldStatus({ value }: { value: WorldStatusValue }) { const { t } = useTranslation(); return <span className={`status status-${value}`}><i />{t(`status.${value}`)}</span>; }
