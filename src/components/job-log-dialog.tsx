"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import type { JobView } from "@/contracts/job";

export function JobLogDialog({ job, onClose }: { job: JobView; onClose(): void }) {
  const query = useQuery({ queryKey: ["job-logs", job.id], queryFn: async () => { const response = await fetch(`/api/jobs/${job.id}/logs`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.logs as Array<{ id: number; message: string; createdAt: number }>; }, refetchInterval: job.state === "running" || job.state === "queued" ? 1_000 : false });
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog job-dialog"><Dialog.Title>{job.kind}</Dialog.Title><Dialog.Description>{job.state} · {job.progress}% · {job.message}{job.error ? ` — ${job.error}` : ""}</Dialog.Description><pre className="console-output job-output">{query.isLoading ? "Loading output…" : (query.data ?? []).map((line) => line.message).join("\n") || "This operation did not produce command output."}</pre><div className="dialog-actions"><button className="button ghost" onClick={() => void query.refetch()}>Refresh</button><button className="button" onClick={onClose}>Close</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
