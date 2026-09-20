"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { JobView } from "@/contracts/job";
import { AppShell } from "./app-shell";
import { JobLogDialog } from "./job-log-dialog";

async function jobs(): Promise<JobView[]> { const response = await fetch("/api/jobs?limit=250"); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.jobs; }
export function OperationsPage() {
  const query = useQuery({ queryKey: ["jobs"], queryFn: jobs, refetchInterval: 2_000 }); const [selected, setSelected] = useState<JobView | null>(null); const [filter, setFilter] = useState("all");
  const records = useMemo(() => (query.data ?? []).filter((item) => filter === "all" || item.state === filter), [query.data, filter]);
  const active = (query.data ?? []).filter((item) => item.state === "running" || item.state === "queued").length;
  return <AppShell active="operations"><header className="topbar"><div><p className="eyebrow">OPERATIONS</p><h1>Downloads and jobs</h1><p className="page-subtitle">Persistent progress and output for installs, updates, backups, restores, and lifecycle operations.</p></div><button className="button ghost" onClick={() => void query.refetch()}>Refresh</button></header><div className="operation-summary"><article><strong>{active}</strong><span>Active</span></article><article><strong>{(query.data ?? []).filter((item) => item.state === "failed").length}</strong><span>Failed</span></article><article><strong>{query.data?.length ?? 0}</strong><span>Recorded</span></article></div><div className="filter-bar">{["all", "running", "succeeded", "failed", "cancelled"].map((value) => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div><div className="job-list operation-list">{records.map((job) => <button className="job job-button" key={job.id} onClick={() => setSelected(job)}><span className={`job-state ${job.state}`} /><span><strong>{job.kind}</strong><small>{job.message}{job.error ? ` — ${job.error}` : ""}</small></span><span className="progress"><i style={{ width: `${job.progress}%` }} /></span><time>{new Date(job.createdAt).toLocaleString()}</time></button>)}{!records.length && <p className="muted padded">No matching operations.</p>}</div>{selected && <JobLogDialog job={selected} onClose={() => setSelected(null)} />}</AppShell>;
}
