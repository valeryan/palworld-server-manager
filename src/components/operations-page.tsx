"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { JobView } from "@/contracts/job";
import { AppShell } from "./app-shell";
import { JobLogDialog } from "./job-log-dialog";
import { jobDisplayMessage, jobKindLabel, jobStateLabel } from "@/lib/job-presentation";

type JobResponse = { jobs: JobView[]; summary: { total: number; active: number; failed: number } };
async function jobs(limit: number): Promise<JobResponse> { const response = await fetch(`/api/jobs?limit=${limit}`); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }
export function OperationsPage() {
  const [limit, setLimit] = useState(25); const query = useQuery({ queryKey: ["jobs", limit], queryFn: () => jobs(limit), refetchInterval: 2_000 }); const [selected, setSelected] = useState<JobView | null>(null); const [filter, setFilter] = useState("all");
  const records = useMemo(() => (query.data?.jobs ?? []).filter((item) => filter === "all" || filter === "active" ? filter === "all" || item.state === "running" || item.state === "queued" : item.state === filter), [query.data, filter]);
  const summary = query.data?.summary ?? { total: 0, active: 0, failed: 0 };
  const filters = [{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "succeeded", label: "Completed" }, { value: "failed", label: "Failed" }, { value: "cancelled", label: "Canceled" }];
  return <AppShell active="operations"><header className="topbar"><div><p className="eyebrow">OPERATIONS</p><h1>Operation history</h1><p className="page-subtitle">Progress, results, and command output for server management tasks.</p></div><button className="button ghost" onClick={() => void query.refetch()}>Refresh</button></header><div className="operation-summary"><article><strong>{summary.active}</strong><span>Active now</span></article><article><strong>{summary.failed}</strong><span>Needs attention</span></article><article><strong>{summary.total}</strong><span>Retained entries</span></article></div><div className="filter-bar">{filters.map(({ value, label }) => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="job-list operation-list">{records.map((job) => <button className="job job-button" key={job.id} onClick={() => setSelected(job)}><span className={`job-state ${job.state}`} /><span><strong>{jobKindLabel(job.kind)}</strong><small>{jobStateLabel(job.state)} · {jobDisplayMessage(job)}{job.error ? ` — ${job.error}` : ""}</small></span><span className="progress"><i style={{ width: `${job.progress}%` }} /></span><time title="Operation requested">{new Date(job.createdAt).toLocaleString()}</time></button>)}{!records.length && <p className="muted padded">No operations match this filter.</p>}</div>{(query.data?.jobs.length ?? 0) < summary.total && <button className="button ghost history-more" onClick={() => setLimit((value) => Math.min(10_000, value + 25))}>Load 25 older operations</button>}{selected && <JobLogDialog job={selected} onClose={() => setSelected(null)} />}</AppShell>;
}
