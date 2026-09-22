"use client";
import { useTranslation } from "react-i18next";
import type { JobState, JobView } from "@/contracts/job";
import { humanizeIdentifier } from "@/lib/job-presentation";

export function useJobPresentation() {
  const { t } = useTranslation();
  const kindLabel = (kind: string) => t(`jobs.kind.${kind}`, { defaultValue: humanizeIdentifier(kind) });
  const startingMessage = (kind: string) => t(`jobs.starting.${kind}`, { defaultValue: t("jobs.message.runningUnknown", { kind: kindLabel(kind).toLocaleLowerCase() }) });
  const successMessage = (kind: string) => t(`jobs.success.${kind}`, { defaultValue: `${kindLabel(kind)} completed` });
  const stateLabel = (state: JobState) => t(`jobs.state.${state}`);
  const displayMessage = (job: Pick<JobView, "kind" | "state" | "message">) => {
    const kind = kindLabel(job.kind);
    if (job.message === "Queued") return t("jobs.message.waiting", { kind });
    if (job.message === "Starting") return startingMessage(job.kind);
    if (job.message === "Complete") return successMessage(job.kind);
    if (job.message === "Failed") return t("jobs.message.failed", { kind });
    if (job.message === "Cancelled") return t("jobs.message.cancelled", { kind });
    if (job.message === "Cancelling") return t("jobs.message.cancelling", { kind: kind.toLocaleLowerCase() });
    return job.message;
  };
  return { kindLabel, startingMessage, successMessage, stateLabel, displayMessage };
}
