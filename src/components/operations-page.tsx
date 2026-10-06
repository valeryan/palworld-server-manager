"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JobView } from "@/contracts/job";
import { AppShell } from "./app-shell";
import { JobLogDialog } from "./job-log-dialog";
import { JobRow } from "./job-row";
import { fetchJson } from "@/lib/http-client";

type JobResponse = { jobs: JobView[]; summary: { total: number; active: number; failed: number } };
const jobs = (limit: number) => fetchJson<JobResponse>(`/api/jobs?limit=${limit}`);
export function OperationsPage() {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(25); const query = useQuery({ queryKey: ["jobs", limit], queryFn: () => jobs(limit), refetchInterval: 2_000 }); const [selected, setSelected] = useState<JobView | null>(null); const [filter, setFilter] = useState("all");
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("job"); if (!linked) return;
    void fetchJson<{ job: JobView }>(`/api/jobs/${encodeURIComponent(linked)}`).then((body) => setSelected(body.job)).catch(() => undefined);
  }, []);
  const records = useMemo(() => (query.data?.jobs ?? []).filter((item) => filter === "all" || filter === "active" ? filter === "all" || item.state === "running" || item.state === "queued" : item.state === filter), [query.data, filter]);
  const summary = query.data?.summary ?? { total: 0, active: 0, failed: 0 };
  const filters = [{ value: "all", label: t("operations.filter.all") }, { value: "active", label: t("operations.filter.active") }, { value: "succeeded", label: t("operations.filter.completed") }, { value: "failed", label: t("operations.filter.failed") }, { value: "cancelled", label: t("operations.filter.cancelled") }];
  return <AppShell active="operations"><header className="topbar"><div><p className="eyebrow">{t("operations.eyebrow")}</p><h1>{t("operations.title")}</h1><p className="page-subtitle">{t("operations.subtitle")}</p></div><button className="button ghost" onClick={() => void query.refetch()}>{t("common.refresh")}</button></header><div className="operation-summary"><article><strong>{summary.active}</strong><span>{t("operations.active")}</span></article><article><strong>{summary.failed}</strong><span>{t("operations.attention")}</span></article><article><strong>{summary.total}</strong><span>{t("operations.retained")}</span></article></div><div className="filter-bar">{filters.map(({ value, label }) => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>{query.error && <p role="alert">{query.error.message}</p>}<div className="job-list operation-list">{records.map((job) => <JobRow key={job.id} job={job} onSelect={setSelected} />)}{!records.length && <p className="muted padded">{t("operations.empty")}</p>}</div>{(query.data?.jobs.length ?? 0) < summary.total && <button className="button ghost history-more" onClick={() => setLimit((value) => Math.min(10_000, value + 25))}>{t("operations.loadOlder")}</button>}{selected && <JobLogDialog job={selected} onClose={() => setSelected(null)} />}</AppShell>;
}
