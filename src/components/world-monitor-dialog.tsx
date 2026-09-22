"use client";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocaleDateTime } from "@/lib/use-locale-format";
import type { WorldView } from "@/contracts/world";
import { humanizeIdentifier } from "@/lib/job-presentation";

type SafeWorld = Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
type Activity = { events: Array<{ id: number; kind: string; message: string; createdAt: number }>; sessions: Array<{ id: number; playerName: string | null; event: string; createdAt: number }>; deaths: Array<{ id: number; victim: string; cause: string | null; killer: string | null; createdAt: number }> };
type Logs = { files: string[]; selected: string | null; sizeBytes?: number; content: string };
type LiveStatus = { reachable: boolean; info: unknown; players: unknown; metrics: unknown; error?: string };
async function get<T>(url: string): Promise<T> { const response = await fetch(url); const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body; }

export function WorldMonitorDialog({ world, onClose }: { world: SafeWorld; onClose(): void }) {
  const { t } = useTranslation();
  const dateTime = useLocaleDateTime();
  const logs = useQuery({ queryKey: ["world-logs", world.id], queryFn: async () => (await get<{ logs: Logs }>(`/api/worlds/${world.id}/logs`)).logs, refetchInterval: world.status === "running" ? 2_000 : 10_000 });
  const activity = useQuery({ queryKey: ["world-activity", world.id], queryFn: async () => (await get<{ activity: Activity }>(`/api/worlds/${world.id}/activity`)).activity, refetchInterval: 10_000 });
  const status = useQuery({ queryKey: ["world-live-status", world.id], queryFn: async () => (await get<{ status: LiveStatus }>(`/api/worlds/${world.id}/status`)).status, refetchInterval: world.status === "running" ? 5_000 : false });
  const playerPayload = status.data?.players as { players?: unknown[] } | null | undefined;
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog monitor-dialog"><Dialog.Title>{t("monitor.title", { world: world.displayName })}</Dialog.Title><Dialog.Description>{t("monitor.description")}</Dialog.Description><Tabs.Root defaultValue="console"><Tabs.List className="tab-list"><Tabs.Trigger value="console">{t("monitor.console")}</Tabs.Trigger><Tabs.Trigger value="health">{t("monitor.health")}</Tabs.Trigger><Tabs.Trigger value="events">{t("monitor.history")}</Tabs.Trigger></Tabs.List>
    <Tabs.Content value="console"><div className="monitor-toolbar"><span>{logs.data?.selected ?? t("monitor.noLog")}</span><span>{logs.data?.sizeBytes ? `${Math.ceil(logs.data.sizeBytes / 1024)} KiB` : ""}</span><button onClick={() => void logs.refetch()}>{t("common.refresh")}</button></div><pre className="console-output">{logs.isLoading ? t("monitor.loadingLog") : logs.data?.content || t("monitor.noLogOutput")}</pre></Tabs.Content>
    <Tabs.Content value="health"><div className="health-summary"><article><span>{t("monitor.process")}</span><strong>{t(`status.${world.status}`)}</strong></article><article><span>{t("monitor.rest")}</span><strong className={status.data?.reachable ? "green" : ""}>{t(status.data?.reachable ? "monitor.reachable" : "monitor.offline")}</strong></article><article><span>{t("monitor.players")}</span><strong>{playerPayload?.players?.length ?? "—"}</strong></article></div>{status.data?.error && <p className="error-text">{status.data.error}</p>}<div className="json-grid"><section><h4>{t("monitor.serverInfo")}</h4><pre>{JSON.stringify(status.data?.info, null, 2) || t("monitor.notAvailable")}</pre></section><section><h4>{t("monitor.metrics")}</h4><pre>{JSON.stringify(status.data?.metrics, null, 2) || t("monitor.notAvailable")}</pre></section><section><h4>{t("monitor.players")}</h4><pre>{JSON.stringify(status.data?.players, null, 2) || t("monitor.notAvailable")}</pre></section></div></Tabs.Content>
    <Tabs.Content value="events"><div className="history-grid"><section><h4>{t("monitor.events")}</h4>{(activity.data?.events ?? []).map((item) => <div className="history-row" key={item.id}><strong>{humanizeIdentifier(item.kind)}</strong><span>{item.message}</span><time>{dateTime(item.createdAt)}</time></div>)}</section><section><h4>{t("monitor.sessions")}</h4>{(activity.data?.sessions ?? []).map((item) => <div className="history-row" key={item.id}><strong>{humanizeIdentifier(item.event)}</strong><span>{item.playerName ?? t("common.unknownPlayer")}</span><time>{dateTime(item.createdAt)}</time></div>)}</section><section><h4>{t("monitor.deaths")}</h4>{(activity.data?.deaths ?? []).map((item) => <div className="history-row" key={item.id}><strong>{item.victim}</strong><span>{item.killer ? `${item.cause ?? t("common.unknown")} — ${item.killer}` : item.cause ?? t("common.unknown")}</span><time>{dateTime(item.createdAt)}</time></div>)}</section></div></Tabs.Content>
  </Tabs.Root><div className="dialog-actions"><button className="button ghost" onClick={onClose}>{t("common.close")}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
