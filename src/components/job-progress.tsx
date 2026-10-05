"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import type { JobView } from "@/contracts/job";
import { fetchJson } from "@/lib/http-client";
import { useJobPresentation } from "@/lib/use-job-presentation";

async function job(jobId: string): Promise<JobView> { return (await fetchJson<{ job: JobView }>(`/api/jobs/${jobId}`)).job; }
const finishedJob = (value: JobView | undefined) => value && value.state !== "running" && value.state !== "queued" ? value : null;

// Inline progress for an operation started from a panel; reports once when it settles.
export function JobProgress({ jobId, onFinished }: { jobId: string; onFinished(job: JobView): void }) {
  const presentation = useJobPresentation();
  const query = useQuery({ queryKey: ["job", jobId], queryFn: () => job(jobId), refetchInterval: (state) => finishedJob(state.state.data) ? false : 1_000 });
  const finish = useEffectEvent(onFinished);
  const finished = finishedJob(query.data);
  useEffect(() => { if (finished) finish(finished); }, [finished]);
  if (!query.data) return null;
  return <><span className="progress"><i style={{ width: `${query.data.progress}%` }} /></span><small>{presentation.displayMessage(query.data)}</small></>;
}
