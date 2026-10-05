"use client";
import { requestJson as request } from "@/lib/http-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocaleDateTime } from "@/lib/use-locale-format";
import type { MaintenanceSettingsInput, ScheduleAction, ScheduleMode } from "@/contracts/schedule";
import { SCHEDULE_ACTIONS } from "@/contracts/schedule";
import type { PublicWorldView } from "@/contracts/world";

type SafeWorld = PublicWorldView;
type Action = ScheduleAction;
type Mode = ScheduleMode;
type Schedule = { id: string; action: Action; mode: Mode; intervalHours: number | null; intervalMinutes: number | null; timeOfDay: string | null; message: string | null; joinMatch: string | null; joinDelaySeconds: number | null; enabled: boolean; skipNext: boolean; lastRunAt: number | null; nextRunAt: number | null };
type WarningSettings = MaintenanceSettingsInput;

const actions: readonly Action[] = SCHEDULE_ACTIONS;

export function WorldSchedulesPanel({ world, onNotice }: { world: SafeWorld; onNotice(message: string): void }) {
  const { t } = useTranslation();
  const dateTime = useLocaleDateTime();
  const client = useQueryClient(); const [mode, setMode] = useState<Mode>("interval"); const [action, setAction] = useState<Action>("backup");
  const key = ["schedules", world.id];
  const query = useQuery({ queryKey: key, queryFn: async () => (await request<{ schedules: Schedule[] }>(`/api/worlds/${world.id}/schedules`)).schedules });
  const warningQuery = useQuery({ queryKey: ["maintenance-settings", world.id], queryFn: async () => (await request<{ settings: WarningSettings }>(`/api/worlds/${world.id}/schedules/settings`)).settings });
  const refresh = () => void client.invalidateQueries({ queryKey: key });
  const create = useMutation({ mutationFn: (payload: object) => request(`/api/worlds/${world.id}/schedules`, { method: "POST", body: JSON.stringify(payload) }), onSuccess: () => { onNotice(t("schedules.created")); refresh(); }, onError: (error) => onNotice(error.message) });
  const patch = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: object }) => request(`/api/schedules/${id}`, { method: "PATCH", body: JSON.stringify(payload) }), onSuccess: refresh, onError: (error) => onNotice(error.message) });
  const remove = useMutation({ mutationFn: (id: string) => request(`/api/schedules/${id}`, { method: "DELETE" }), onSuccess: () => { onNotice(t("schedules.deleted")); refresh(); }, onError: (error) => onNotice(error.message) });
  function changeAction(value: Action) { setAction(value); if (value === "idle_stop" && (mode === "daily" || mode === "on_join")) setMode("interval"); if (value !== "system_message" && value !== "onscreen_notice" && mode === "on_join") setMode("interval"); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    create.mutate({ action, mode, ...(mode === "interval" ? { intervalHours: Number(data.get("intervalHours")) } : {}), ...(mode === "minutes" ? { intervalMinutes: Number(data.get("intervalMinutes")) } : {}), ...(mode === "daily" ? { timeOfDay: data.get("timeOfDay") } : {}), ...((action === "system_message" || action === "onscreen_notice") ? { message: data.get("message"), ...(mode === "on_join" ? { joinMatch: data.get("joinMatch"), joinDelaySeconds: Number(data.get("joinDelaySeconds")) } : {}) } : {}), ...(action === "custom_http" ? { httpMethod: data.get("httpMethod"), httpUrl: data.get("httpUrl"), httpHeaders: data.get("httpHeaders"), httpBody: data.get("httpBody") } : {}), enabled: true });
  }
  const modes: Mode[] = action === "idle_stop" ? ["interval", "minutes"] : action === "system_message" || action === "onscreen_notice" ? ["interval", "minutes", "daily", "on_join"] : ["interval", "minutes", "daily"];
  const actionLabel = (value: Action) => t(`schedules.action.${value}`);
  const modeLabel = (value: Mode) => value === "interval" ? t(action === "idle_stop" ? "schedules.mode.intervalIdle" : "schedules.mode.interval") : value === "minutes" ? t(action === "idle_stop" ? "schedules.mode.minutesIdle" : "schedules.mode.minutes") : t(value === "daily" ? "schedules.mode.daily" : "schedules.mode.onJoin");
  const when = (value: number | null) => value ? dateTime(value) : t("schedules.eventDriven");
  const describe = (item: Schedule) => {
    if (item.mode === "on_join") { const condition = item.joinMatch ? t("schedules.whenPlayer", { player: item.joinMatch }) : t("schedules.whenAnyone"); return `${t("schedules.joins", { condition })}${item.joinDelaySeconds ? ` ${t("schedules.afterSeconds", { count: item.joinDelaySeconds })}` : ""}`; }
    if (item.mode === "daily") return t("schedules.dailyAt", { time: item.timeOfDay });
    if (item.mode === "minutes") return t(item.action === "idle_stop" ? "schedules.emptyMinutes" : "schedules.everyMinutes", { count: item.intervalMinutes });
    return t(item.action === "idle_stop" ? "schedules.emptyHours" : "schedules.everyHours", { count: item.intervalHours ?? Math.ceil((item.intervalMinutes ?? 0) / 60) });
  };
  return <div className="schedule-panel"><WarningConfiguration worldId={world.id} data={warningQuery.data} loading={warningQuery.isLoading} onNotice={onNotice} onSaved={() => void warningQuery.refetch()} />
    <div className="panel-heading"><div><h2>{t("schedules.title")}</h2><p>{t("schedules.description")}</p></div></div>
    <form className="schedule-form expanded" onSubmit={submit}><label>{t("schedules.actionLabel")}<select name="action" value={action} onChange={(event) => changeAction(event.target.value as Action)}>{actions.map((value) => <option key={value} value={value}>{actionLabel(value)}</option>)}</select></label><label>{t("schedules.whenLabel")}<select name="mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>{modes.map((value) => <option key={value} value={value}>{modeLabel(value)}</option>)}</select></label>
      {mode === "interval" && <label>{t("schedules.hours")}<input name="intervalHours" type="number" min="1" max="720" defaultValue="6" /></label>}{mode === "minutes" && <label>{t("schedules.minutes")}<input name="intervalMinutes" type="number" min="1" max="43200" defaultValue="60" /></label>}{mode === "daily" && <label>{t("schedules.localTime")}<input name="timeOfDay" type="time" defaultValue="04:00" /></label>}
      {(action === "system_message" || action === "onscreen_notice") && <label className="schedule-wide">{t("schedules.message")}<input name="message" required maxLength={2000} placeholder={t(mode === "on_join" ? "schedules.welcomePlaceholder" : "schedules.maintenancePlaceholder")} /><small>{t(action === "onscreen_notice" ? "schedules.noticeHelp" : "schedules.messageHelp")}</small></label>}
      {mode === "on_join" && <><label>{t("schedules.onlyPlayer")}<input name="joinMatch" maxLength={128} placeholder={t("schedules.anyPlayer")} /></label><label>{t("schedules.joinDelay")}<input name="joinDelaySeconds" type="number" min="0" max="3600" defaultValue="5" /></label></>}
      {action === "custom_http" && <><label>{t("schedules.method")}<select name="httpMethod" defaultValue="POST"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label><label className="schedule-wide">{t("schedules.url")}<input name="httpUrl" type="url" required placeholder="https://example.internal/hook" /></label><label className="schedule-wide">{t("schedules.headers")}<textarea name="httpHeaders" placeholder={'Authorization: Bearer …\nContent-Type: application/json'} /></label><label className="schedule-wide">{t("schedules.body")}<textarea name="httpBody" placeholder='{"world":"maintenance"}' /></label></>}
      <button className="button primary" disabled={create.isPending}>{t("schedules.add")}</button></form>
    <div className="schedule-list">{query.isLoading ? <p className="muted">{t("schedules.loading")}</p> : (query.data ?? []).length === 0 ? <p className="muted">{t("schedules.empty")}</p> : (query.data ?? []).map((item) => <article key={item.id}><div><strong>{actionLabel(item.action)}</strong><span>{describe(item)}</span><small>{t("schedules.next", { date: when(item.nextRunAt) })}{item.lastRunAt ? ` · ${t("schedules.last", { date: when(item.lastRunAt) })}` : ` · ${t("schedules.never")}`}{item.skipNext ? ` · ${t("schedules.willBeSkipped")}` : ""}</small></div><div className="schedule-actions"><button onClick={() => patch.mutate({ id: item.id, payload: { enabled: !item.enabled } })}>{t(item.enabled ? "common.disable" : "common.enable")}</button><button disabled={!item.enabled || item.skipNext} onClick={() => patch.mutate({ id: item.id, payload: { skipNext: true } })}>{t(item.skipNext ? "schedules.willSkip" : "schedules.skipNext")}</button><button className="danger" onClick={() => { if (window.confirm(t("schedules.deleteConfirm", { action: actionLabel(item.action) }))) remove.mutate(item.id); }}>{t("common.delete")}</button></div></article>)}</div>
  </div>;
}

function WarningConfiguration({ worldId, data, loading, onNotice, onSaved }: { worldId: string; data?: WarningSettings; loading: boolean; onNotice(message: string): void; onSaved(): void }) {
  const { t } = useTranslation();
  const [enabledDraft, setEnabledDraft] = useState<boolean>(); const [leadDraft, setLeadDraft] = useState<number>(); const [intervalDraft, setIntervalDraft] = useState<number>(); const [messageDraft, setMessageDraft] = useState<string>();
  const enabled = enabledDraft ?? data?.warningEnabled ?? false; const lead = leadDraft ?? data?.warningLeadMinutes ?? 10; const interval = intervalDraft ?? data?.warningIntervalMinutes ?? 2; const message = messageDraft ?? data?.warningMessage ?? t("warnings.defaultMessage");
  const save = useMutation({ mutationFn: () => request(`/api/worlds/${worldId}/schedules/settings`, { method: "PUT", body: JSON.stringify({ warningEnabled: enabled, warningLeadMinutes: lead, warningIntervalMinutes: interval, warningMessage: message }) }), onSuccess: () => { setEnabledDraft(undefined); setLeadDraft(undefined); setIntervalDraft(undefined); setMessageDraft(undefined); onNotice(t("warnings.saved")); onSaved(); }, onError: (error) => onNotice(error.message) });
  return <section className={`warning-settings ${enabled ? "enabled" : ""}`}><div><h2>{t("warnings.title")}</h2><p>{t("warnings.description")}</p></div><button className={`toggle ${enabled ? "on" : ""}`} onClick={() => setEnabledDraft(!enabled)}><i />{t(enabled ? "common.on" : "common.off")}</button>{enabled && <div className="warning-fields"><label>{t("warnings.start")}<input type="number" min="1" max="120" value={lead} onChange={(event) => setLeadDraft(Number(event.target.value))} /></label><label>{t("warnings.repeat")}<input type="number" min="0" max="120" value={interval} onChange={(event) => setIntervalDraft(Number(event.target.value))} /></label><label className="schedule-wide">{t("warnings.message")}<input value={message} onChange={(event) => setMessageDraft(event.target.value)} /><small>{t("warnings.placeholders")}</small></label></div>}<button className="button ghost warning-save" disabled={loading || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? "common.saving" : "warnings.save")}</button></section>;
}
