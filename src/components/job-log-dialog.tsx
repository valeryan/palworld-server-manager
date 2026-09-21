"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobView } from "@/contracts/job";
import { jobDisplayMessage, jobKindLabel, jobStateLabel } from "@/lib/job-presentation";

async function responseJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const time = (value: number | null) => value ? new Date(value).toLocaleString() : "—";

export function JobLogDialog({ job: initialJob, onClose }: { job: JobView; onClose(): void }) {
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
    <Dialog.Title>{jobKindLabel(job.kind)}</Dialog.Title>
    <Dialog.Description className="job-summary"><span className={`job-state-label ${job.state}`}>{jobStateLabel(job.state)}</span><span>{job.progress}%</span><span>{jobDisplayMessage(job)}</span></Dialog.Description>
    {job.error && <p className="job-error">{job.error}</p>}
    <dl className="job-times"><div><dt>Requested</dt><dd>{time(job.createdAt)}</dd></div><div><dt>Started</dt><dd>{time(job.startedAt)}</dd></div><div><dt>Finished</dt><dd>{time(job.finishedAt)}</dd></div></dl>
    {logs.isLoading ? <div className="job-empty">Loading operation details…</div> : output ? <pre className="console-output job-output">{output}</pre> : <div className="job-empty"><strong>No command output</strong><span>This operation reports its result through the status above.</span></div>}
    {cancel.error && <p className="error-text">{cancel.error.message}</p>}
    <div className="dialog-actions"><button className="button ghost" onClick={refresh}>Refresh details</button>{active && <button className="button danger" disabled={cancel.isPending} onClick={() => { if (window.confirm(`Cancel ${jobKindLabel(job.kind).toLowerCase()}?`)) cancel.mutate(); }}>{cancel.isPending ? "Canceling…" : "Cancel operation"}</button>}<button className="button" onClick={onClose}>Close</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
