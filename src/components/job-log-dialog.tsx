"use client";
import { fetchJson as responseJson } from "@/lib/http-client";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { JobView } from "@/contracts/job";
import { useJobPresentation } from "@/lib/use-job-presentation";
import { useLocaleDateTime } from "@/lib/use-locale-format";

export function JobLogDialog({ job: initialJob, onClose }: { job: JobView; onClose(): void }) {
  const { t } = useTranslation();
  const jobs = useJobPresentation();
  const dateTime = useLocaleDateTime();
  const time = (value: number | null) => value ? dateTime(value) : "—";
  const client = useQueryClient();
  const details = useQuery({
    queryKey: ["job", initialJob.id],
    queryFn: async () => (await responseJson<{ job: JobView }>(`/api/jobs/${initialJob.id}`)).job,
    initialData: initialJob,
    refetchInterval: (query) => query.state.data?.state === "running" || query.state.data?.state === "queued" ? 1_000 : false,
  });
  const job = details.data;
  const active = job.state === "running" || job.state === "queued";
  const logs = useQuery({
    queryKey: ["job-logs", job.id],
    queryFn: async () => (await responseJson<{ logs: Array<{ id: number; message: string; createdAt: number }> }>(`/api/jobs/${job.id}/logs`)).logs,
    refetchInterval: active ? 1_000 : false,
  });
  const cancel = useMutation({ mutationFn: () => responseJson(`/api/jobs/${job.id}/cancel`, { method: "POST" }), onSuccess: () => { void details.refetch(); void client.invalidateQueries({ queryKey: ["jobs"] }); } });
  const output = (logs.data ?? []).map((line) => line.message).join("\n");
  function refresh() { void details.refetch(); void logs.refetch(); }

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog job-dialog">
    <Dialog.Title>{jobs.kindLabel(job.kind)}</Dialog.Title>
    <Dialog.Description className="job-summary"><span className={`job-state-label ${job.state}`}>{jobs.stateLabel(job.state)}</span><span>{job.progress}%</span><span>{jobs.displayMessage(job)}</span></Dialog.Description>
    {job.error && <p className="job-error">{job.error}</p>}
    <dl className="job-times"><div><dt>{t("jobs.dialog.requested")}</dt><dd>{time(job.createdAt)}</dd></div><div><dt>{t("jobs.dialog.started")}</dt><dd>{time(job.startedAt)}</dd></div><div><dt>{t("jobs.dialog.finished")}</dt><dd>{time(job.finishedAt)}</dd></div></dl>
    {logs.isLoading ? <div className="job-empty">{t("jobs.dialog.loading")}</div> : output ? <pre className="console-output job-output">{output}</pre> : <div className="job-empty"><strong>{t("jobs.dialog.noOutput")}</strong><span>{t("jobs.dialog.noOutputHelp")}</span></div>}
    {cancel.error && <p className="error-text">{cancel.error.message}</p>}
    <div className="dialog-actions"><button className="button ghost" onClick={refresh}>{t("jobs.dialog.refresh")}</button>{active && <button className="button danger" disabled={cancel.isPending} onClick={() => { if (window.confirm(t("jobs.dialog.cancelConfirm", { kind: jobs.kindLabel(job.kind).toLocaleLowerCase() }))) cancel.mutate(); }}>{t(cancel.isPending ? "jobs.dialog.cancelling" : "jobs.dialog.cancel")}</button>}<button className="button" onClick={onClose}>{t("common.close")}</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
