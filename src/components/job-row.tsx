"use client";
import { useTranslation } from "react-i18next";
import type { JobView } from "@/contracts/job";
import { useJobPresentation } from "@/lib/use-job-presentation";
import { useLocaleDateTime } from "@/lib/use-locale-format";

export function JobRow({ job, onSelect }: { job: JobView; onSelect(job: JobView): void }) {
  const { t } = useTranslation(); const presentation = useJobPresentation(); const dateTime = useLocaleDateTime();
  return <button className="job job-button" onClick={() => onSelect(job)}><span className={`job-state ${job.state}`} /><span><strong>{presentation.kindLabel(job.kind)}</strong><small>{presentation.stateLabel(job.state)} · {presentation.displayMessage(job)}{job.error ? ` — ${job.error}` : ""}</small></span><span className="progress"><i style={{ width: `${job.progress}%` }} /></span><time title={t("operations.requested")}>{dateTime(job.createdAt)}</time></button>;
}
