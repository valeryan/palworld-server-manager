"use client";
import { useTranslation } from "react-i18next";
import { APP_JOB_KINDS, type JobView } from "@/contracts/job";
import { useJobPresentation } from "@/lib/use-job-presentation";
import { useLocaleDateTime } from "@/lib/use-locale-format";

// `worldName` labels the row in fleet-wide lists; a world-less job of a world kind belonged to a
// world that has since been removed.
export function JobRow({ job, worldName, onSelect }: { job: JobView; worldName?: string; onSelect(job: JobView): void }) {
  const { t } = useTranslation(); const presentation = useJobPresentation(); const dateTime = useLocaleDateTime();
  const scope = job.worldId ? worldName : APP_JOB_KINDS.has(job.kind) ? undefined : t("jobs.removedWorld");
  return <button className="job job-button" onClick={() => onSelect(job)}><span className={`job-state ${job.state}`} /><span><strong>{scope && <em className="job-world">{scope}</em>}{presentation.kindLabel(job.kind)}</strong><small>{presentation.stateLabel(job.state)} · {presentation.displayMessage(job)}{job.error ? ` — ${job.error}` : ""}</small></span><span className="progress"><i style={{ width: `${job.progress}%` }} /></span><time title={t("operations.requested")}>{dateTime(job.createdAt)}</time></button>;
}
