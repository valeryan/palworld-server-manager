"use client";
import { requestJson as json } from "@/lib/http-client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { JobListResponse, JobView } from "@/contracts/job";
import type { AdvertisedPortState, KnownPlayer, PublicWorldView, WorldOverview } from "@/contracts/world";
import { WorldSchedulesPanel } from "./world-schedules-dialog";
import { WorldBackupsPanel } from "./world-backups-panel";
import { WorldModsPanel } from "./world-mods-panel";
import { WorldConsolePanel, type WorldLogs } from "./world-console-panel";
import { SettingsMenu as WorldSettingsMenu } from "./world-settings-menu";
import { AppShell } from "./app-shell";
import { StructuredSettings } from "./structured-settings";
import { Toast } from "./toast";
import { fetchJob, JobLogDialog } from "./job-log-dialog";
import { JobRow } from "./job-row";
import { humanizeIdentifier } from "@/lib/job-presentation";
import { playersFrom } from "@/lib/players";
import { useJobPresentation } from "@/lib/use-job-presentation";
import { useLocaleDateTime } from "@/lib/use-locale-format";
import { BuildStatus } from "./build-status";
import { SphereMark } from "./sphere-mark";
import { WorldStatus } from "./world-status";

type SafeWorld = PublicWorldView;
type Tab = "overview" | "players" | "deaths" | "console" | "settings" | "mods" | "backups" | "schedule";
type Live = { reachable: boolean; info?: Record<string, unknown>; players?: { players?: Array<Record<string, unknown>> }; metrics?: Record<string, unknown>; error?: string };
type Activity = { events: Array<{ id: number; kind: string; message: string; createdAt: number }>; sessions: Array<{ id: number; playerName: string | null; event: string; createdAt: number }>; deaths: Array<{ id: number; victim: string; cause: string | null; killer: string | null; killerKind: string | null; createdAt: number }>; hasMore: { events: boolean; sessions: boolean; deaths: boolean } };
type AdvertisedPort = AdvertisedPortState;
type Configuration = { path: string; exists: boolean; content: string; running: boolean; advertisedPort: AdvertisedPort; desiredRevision: number; appliedRevision: number; pendingApply: boolean; applyError: string | null; drift: boolean };
type ConfigVersion = { id: string; note: string | null; createdAt: number; sizeBytes: number };

const tabs: Tab[] = ["overview", "players", "deaths", "console", "settings", "mods", "backups", "schedule"];
export function WorldWorkspace({ worldId }: { worldId: string }) {
  const { t } = useTranslation(); const presentation = useJobPresentation(); const stamp = useLocaleDateTime();
  const client = useQueryClient(); const [tab, setTab] = useState<Tab>("overview"); const [settingsMode, setSettingsMode] = useState<"guided" | "raw">("guided"); const [notice, setNotice] = useState<string | null>(null); const [draft, setDraft] = useState<string | null>(null); const [logsPaused, setLogsPaused] = useState(false); const [selectedLog, setSelectedLog] = useState<string>(); const [activityLimit, setActivityLimit] = useState(25); const [jobLimit, setJobLimit] = useState(10); const [selectedJob, setSelectedJob] = useState<JobView | null>(null);
  const worldQuery = useQuery({ queryKey: ["world", worldId], queryFn: async () => (await json<{ world: SafeWorld }>(`/api/worlds/${worldId}`)).world, refetchInterval: 4_000 });
  const world = worldQuery.data;
  const liveQuery = useQuery({ queryKey: ["world-status", worldId], queryFn: async () => (await json<{ status: Live }>(`/api/worlds/${worldId}/status`)).status, refetchInterval: world?.status === "running" ? 5_000 : false });
  const activityQuery = useQuery({ queryKey: ["world-activity", worldId, activityLimit], queryFn: async () => (await json<{ activity: Activity }>(`/api/worlds/${worldId}/activity?limit=${activityLimit}`)).activity, refetchInterval: 10_000 });
  const overviewQuery = useQuery({ queryKey: ["world-overview", worldId], queryFn: async () => (await json<{ overview: WorldOverview }>(`/api/worlds/${worldId}/overview`)).overview, enabled: tab === "overview" });
  const jobsQuery = useQuery({ queryKey: ["jobs", "world", worldId, jobLimit], queryFn: () => json<JobListResponse>(`/api/jobs?worldId=${encodeURIComponent(worldId)}&limit=${jobLimit}`), enabled: tab === "overview", refetchInterval: 4_000 });
  const playersQuery = useQuery({ queryKey: ["world-players", worldId], queryFn: async () => (await json<{ players: KnownPlayer[] }>(`/api/worlds/${worldId}/players`)).players, enabled: tab === "players" });
  const logsQuery = useQuery({ queryKey: ["world-logs", worldId, selectedLog], queryFn: async () => (await json<{ logs: WorldLogs }>(`/api/worlds/${worldId}/logs${selectedLog ? `?file=${encodeURIComponent(selectedLog)}` : ""}`)).logs, refetchInterval: tab === "console" && world?.status === "running" && !logsPaused ? 2_000 : false });
  const configurationQuery = useQuery({ queryKey: ["configuration", worldId], queryFn: async () => (await json<{ configuration: Configuration }>(`/api/worlds/${worldId}/configuration`)).configuration });
  const versionsQuery = useQuery({ queryKey: ["configuration-versions", worldId], queryFn: async () => (await json<{ versions: ConfigVersion[] }>(`/api/worlds/${worldId}/configuration/versions`)).versions });
  const action = useMutation({ mutationFn: (payload: Record<string, unknown>) => json<{ jobId: string }>(`/api/worlds/${worldId}/actions`, { method: "POST", body: JSON.stringify(payload) }), onSuccess: (_, payload) => { setNotice(`${presentation.startingMessage(String(payload.action))}…`); void client.invalidateQueries({ queryKey: ["world", worldId] }); void client.invalidateQueries({ queryKey: ["jobs"] }); }, onError: (error) => setNotice(error.message) });
  const saveConfig = useMutation({ mutationFn: () => json(`/api/worlds/${worldId}/configuration`, { method: "PUT", body: JSON.stringify({ content: draft ?? configurationQuery.data?.content ?? "", baseRevision: configurationQuery.data?.desiredRevision }) }), onSuccess: async () => { setNotice(t("world.config.saved")); await configurationQuery.refetch(); await versionsQuery.refetch(); await client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); }, onError: (error) => setNotice(error.message) });
  const restoreConfig = useMutation({ mutationFn: async (versionId: string) => { const latest = await json<{ configuration: Configuration }>(`/api/worlds/${worldId}/configuration`); return json<{ result: { content: string } }>(`/api/worlds/${worldId}/configuration/versions/${versionId}/restore`, { method: "POST", body: JSON.stringify({ baseRevision: latest.configuration.desiredRevision }) }); }, onSuccess: ({ result }) => { setDraft(result.content); setNotice(t("world.config.restored")); void versionsQuery.refetch(); void client.invalidateQueries({ queryKey: ["configuration", worldId] }); void client.invalidateQueries({ queryKey: ["configuration-options", worldId] }); }, onError: (error) => setNotice(error.message) });
  if (worldQuery.isLoading) return <AppShell active="worlds" className="world-workspace"><div className="empty">{t("world.loading")}</div></AppShell>;
  if (!world) return <AppShell active="worlds" className="world-workspace"><div className="empty error">{t("world.notFound")}</div></AppShell>;
  const live = liveQuery.data; const metrics = live?.metrics ?? {}; const players = live?.players?.players ?? [];
  const run = (name: string) => action.mutate({ action: name });
  const openJob = (id: string) => void fetchJob(id).then(setSelectedJob).catch((error) => setNotice(error.message));
  const menu = { world, mode: settingsMode, onModeChange: setSettingsMode, onNotice: setNotice, onImported: () => setDraft(null) };
  return <AppShell active="worlds" className="world-workspace">
    <Link className="back-link" href="/">{t("world.allWorlds")}</Link>
    <Toast message={notice} onDismiss={() => setNotice(null)} />
    <section className="world-banner"><div className="world-banner-head"><div className="world-icon large"><SphereMark label={world.displayName} /></div><div className="world-title"><div><h1>{world.displayName}</h1><WorldStatus value={world.status} /></div><p>{String(live?.info?.servername ?? world.installDir)}</p></div><div className="world-primary-actions">{world.status === "running" ? <><RestartAction pending={Boolean(configurationQuery.data?.pendingApply)} onRestart={() => run("restart")} label={t("common.restart")} pendingHint={t("world.pendingRestartHint")} /><button className="button danger" onClick={() => run("stop")}>{t("common.stop")}</button></> : world.status === "starting" || world.status === "stopping" ? <button className="button" disabled>{t(world.status === "starting" ? "world.starting" : "world.stopping")}</button> : <button className="button primary" disabled={!world.installation?.canStart} title={world.installation?.reasons.join(" ")} onClick={() => run("start")}>{t("common.start")}</button>}<button className="button ghost" disabled={world.status === "starting" || world.status === "stopping"} onClick={() => run("check-update")}>{t("world.checkBuild")}</button><button className="button ghost" disabled={world.status === "running" || world.status === "starting" || world.status === "stopping"} onClick={() => run(world.installation?.state === "missing" || world.installation?.state === "failed" ? "install" : "update")}>{world.installation?.state === "missing" || world.installation?.state === "failed" ? t("world.installation.retry") : t(world.latestBuildId && world.buildId !== world.latestBuildId ? "world.updateAvailable" : "world.update")}</button></div></div>
      <div className="quick-stats"><Quick label={t("world.stat.players")} value={live?.reachable ? `${players.length}/${String(metrics.maxplayernum ?? "—")}` : "—"} /><Quick label={t("world.stat.uptime")} value={formatUptime(Number(metrics.uptime ?? 0), live?.reachable, t)} /><Quick label={t("world.stat.day")} value={live?.reachable ? String(metrics.days ?? "—") : "—"} /><Quick label={t("world.stat.fps")} value={live?.reachable ? String(metrics.serverfps ?? "—") : "—"} /><Quick label={t("world.stat.build")} value={<BuildStatus installed={world.buildId} latest={world.latestBuildId} />} /><Quick label={t("world.stat.ports")} value={<PortSummary gamePort={world.gamePort} advertised={configurationQuery.data?.advertisedPort} />} /></div>
      {world.installation && (world.installation.state !== "ready" || world.status === "crashed" || world.installation.prerequisite.state !== "installed") && <div className="restart-required"><strong>{t("world.installation.state", { state: world.installation.state })}</strong><p>{world.installation.reasons.join(" ")}</p>{world.installation.lastJobId && <button className="button ghost" onClick={() => openJob(world.installation!.lastJobId!)}>{t("world.installation.viewOutput")}</button>}{world.installation.prerequisite.repairAvailable && <button className="button ghost" disabled={!world.installation.canInstall} onClick={() => { if (window.confirm(t("world.installation.repairConfirm"))) run("repair-prerequisites"); }}>{t("world.installation.repair")}</button>}</div>}
      <div className="connection-row"><span>{t("world.connect")}</span><code>{world.installation?.state === "ready" ? `127.0.0.1:${world.gamePort}` : t("world.installation.connectUnavailable")}</code><button onClick={() => void navigator.clipboard.writeText(`127.0.0.1:${world.gamePort}`)}>{t("common.copy")}</button></div>
    </section>
    <div className="world-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{t(`world.tab.${item}`)}</button>)}</div>
    <section className="world-tab-panel">
      {tab === "overview" && <Overview world={world} configuration={configurationQuery.data} overview={overviewQuery.data} jobs={jobsQuery.data} activity={activityQuery.data} live={live} onOpenJob={setSelectedJob} onOlderJobs={() => setJobLimit((value) => Math.min(10_000, value + 10))} onOlderActivity={() => setActivityLimit((value) => Math.min(500, value + 25))} />}
      {tab === "players" && <Players worldId={worldId} players={players} known={playersQuery.data ?? []} sessions={activityQuery.data?.sessions ?? []} moreSessions={Boolean(activityQuery.data?.hasMore.sessions)} reachable={Boolean(live?.reachable)} onRefresh={() => { void liveQuery.refetch(); void playersQuery.refetch(); }} onOlderSessions={() => setActivityLimit((value) => Math.min(500, value + 25))} onNotice={setNotice} />}
      {tab === "deaths" && <Deaths records={activityQuery.data?.deaths ?? []} hasMore={Boolean(activityQuery.data?.hasMore.deaths)} onLoadOlder={() => setActivityLimit((value) => Math.min(500, value + 25))} />}
      {tab === "console" && <>{logsQuery.error && <p role="alert" className="form-warning">{t("console.error", { error: logsQuery.error.message })}</p>}<WorldConsolePanel world={world} logs={logsQuery.data} paused={logsPaused} onPause={() => setLogsPaused((value) => !value)} onSelect={setSelectedLog} onRefresh={() => void logsQuery.refetch()} onNotice={setNotice} /></>}
      {tab === "settings" && (settingsMode === "guided" ? <StructuredSettings worldId={worldId} onNotice={setNotice} menu={menu} /> : <div><div className="panel-heading"><div><h2>PalWorldSettings.ini</h2><p>{configurationQuery.data?.path}</p></div><div className="panel-heading-actions"><button className="button primary" disabled={saveConfig.isPending} onClick={() => saveConfig.mutate()}>{t("world.config.saveRaw")}</button><WorldSettingsMenu {...menu} baseRevision={configurationQuery.data?.desiredRevision} /></div></div><textarea className="settings-editor" value={draft ?? configurationQuery.data?.content ?? ""} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /><h2 className="settings-history-title">{t("world.config.history")}</h2><div className="record-list">{(versionsQuery.data ?? []).map((version) => <div key={version.id}><span><strong>{version.note ?? t("world.config.version")}</strong><small>{stamp(version.createdAt)} · {t("world.config.bytes", { count: version.sizeBytes })}</small></span><button disabled={restoreConfig.isPending} onClick={() => restoreConfig.mutate(version.id)}>{t("world.config.restore")}</button></div>)}{!(versionsQuery.data ?? []).length && <p className="muted">{t("world.config.noVersions")}</p>}</div></div>)}
      {tab === "mods" && <WorldModsPanel worldId={worldId} running={world.status !== "stopped" && world.status !== "crashed"} onNotice={setNotice} />}
      {tab === "backups" && <WorldBackupsPanel worldId={worldId} canBackup={Boolean(world.installation?.canBackup)} running={world.status === "running"} onBackup={() => world.installation?.canBackup ? action.mutate({ action: "backup", reason: "manual" }) : setNotice(t("world.backupUnavailable"))} onRestore={(backupId) => { if (window.confirm(t("world.backupRestoreConfirm"))) action.mutate({ action: "restore", backupId }); }} onNotice={setNotice} />}
      {tab === "schedule" && <WorldSchedulesPanel world={world} onNotice={setNotice} />}
    </section>
    {selectedJob && <JobLogDialog job={selectedJob} onClose={() => setSelectedJob(null)} />}
  </AppShell>;
}
function Quick({ label, value }: { label: string; value: ReactNode }) { return <article><strong>{value}</strong><span>{label}</span></article>; }
function RestartAction({ pending, onRestart, label, pendingHint }: { pending: boolean; onRestart(): void; label: string; pendingHint: string }) {
  return <button className={`button ghost ${pending ? "restart-pending" : ""}`} title={pending ? pendingHint : undefined} onClick={onRestart}>{label}</button>;
}
function PortSummary({ gamePort, advertised }: { gamePort: number; advertised?: AdvertisedPort }) {
  const { t } = useTranslation();
  if (advertised?.mode === "invalid") return <span className="port-summary invalid" title={t("world.stat.publicPortInvalid", { value: advertised.raw })}>{t("world.stat.portAttention")}</span>;
  if (advertised?.mode === "override") return <span className="port-summary"><small>{t("world.stat.gameShort")}</small>{gamePort}<small>{t("world.stat.publicShort")}</small>{advertised.effectivePort}</span>;
  return <>{gamePort}</>;
}
function formatUptime(seconds: number, reachable: boolean | undefined, t: (key: string, options?: Record<string, unknown>) => string) { if (!reachable) return "—"; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return t("world.uptimeFormat", { hours, minutes }); }

type Tone = "ok" | "warn" | "danger" | "neutral";
function OverviewCard({ label, tone, value, detail }: { label: string; tone: Tone; value: ReactNode; detail?: ReactNode }) {
  return <article className={`overview-card ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <p>{detail}</p>}</article>;
}
// State of the world at a glance, then this world's operations and recorded events. The tab has
// no actions of its own; an operation's output opens from its row.
function Overview({ world, configuration, overview, jobs, activity, live, onOpenJob, onOlderJobs, onOlderActivity }: { world: SafeWorld; configuration?: Configuration; overview?: WorldOverview; jobs?: JobListResponse; activity?: Activity; live?: Live; onOpenJob(job: JobView): void; onOlderJobs(): void; onOlderActivity(): void }) {
  const { t } = useTranslation(); const stamp = useLocaleDateTime();
  const installation = world.installation;
  const healthTone: Tone = !installation ? "neutral" : installation.state === "failed" || world.status === "crashed" ? "danger" : installation.state === "ready" && installation.prerequisite.state === "installed" ? "ok" : "warn";
  const reach = live?.reachable ? t("overview.reachable") : live?.error ?? t("overview.offline");
  const configTone: Tone = !configuration ? "neutral" : configuration.applyError ? "danger" : configuration.drift || configuration.pendingApply ? "warn" : "ok";
  const configValue = !configuration ? "—" : configuration.applyError || configuration.drift || configuration.pendingApply ? t("overview.config.attention") : t("overview.config.inSyncShort");
  const configDetail = !configuration ? undefined : configuration.applyError ? t("structured.pendingApplyError", { error: configuration.applyError }) : configuration.drift ? t("structured.driftDefault") : configuration.pendingApply ? t("overview.config.pending") : t("overview.config.inSync");
  const schedule = overview?.nextSchedule; const backup = overview?.backups.latest; const mods = overview?.modRuntime;
  return <div className="overview">
    <div className="overview-cards">
      <OverviewCard label={t("overview.card.health")} tone={healthTone} value={installation ? t(`world.installation.states.${installation.state}`, { defaultValue: humanizeIdentifier(installation.state) }) : "—"} detail={<>{installation?.reasons.join(" ")}{installation?.reasons.length ? " · " : ""}{reach}</>} />
      <OverviewCard label={t("overview.card.configuration")} tone={configTone} value={configValue} detail={configDetail} />
      <OverviewCard label={t("overview.card.schedule")} tone="neutral" value={schedule ? t(`schedules.action.${schedule.action}`) : t("overview.schedule.none")} detail={schedule ? <>{stamp(schedule.nextRunAt)}{schedule.skipNext ? ` · ${t("schedules.willBeSkipped")}` : ""}</> : overview ? t("overview.schedule.enabled", { count: overview.enabledSchedules }) : undefined} />
      <OverviewCard label={t("overview.card.backup")} tone={backup ? (backup.verified ? "ok" : "warn") : "neutral"} value={backup ? stamp(backup.createdAt) : t("overview.backup.none")} detail={backup ? `${Math.ceil(backup.sizeBytes / 1_048_576)} MiB · ${backup.verified ? t("backups.verified") : t("overview.backup.unverified")} · ${t("overview.backup.count", { count: overview!.backups.count })}` : undefined} />
      <OverviewCard label={t("overview.card.mods")} tone={mods ? (mods.recoveryPaused ? "warn" : mods.enabled ? "ok" : "neutral") : "neutral"} value={mods ? `UE4SS ${mods.version}` : t("overview.mods.none")} detail={mods ? <>{t(mods.enabled ? "common.on" : "common.off")}{mods.earlyCrashes ? ` · ${t("overview.mods.earlyCrashes", { count: mods.earlyCrashes })}` : ""}{mods.recoveryPaused ? ` · ${t("overview.mods.recoveryPaused")}` : ""}</> : undefined} />
    </div>
    <section><h2>{t("overview.operations")}</h2><div className="job-list">{(jobs?.jobs ?? []).map((job) => <JobRow key={job.id} job={job} onSelect={onOpenJob} />)}{jobs && !jobs.jobs.length && <p className="muted padded">{t("overview.noOperations")}</p>}</div>{jobs && jobs.jobs.length < jobs.summary.total && <button className="button ghost history-more" onClick={onOlderJobs}>{t("overview.loadOlderOperations")}</button>}</section>
    <section><h2>{t("overview.activity")}</h2>{(activity?.events ?? []).length ? activity!.events.map((item) => <div className="history-row" key={item.id}><strong>{t(`events.kind.${item.kind}`, { defaultValue: humanizeIdentifier(item.kind) })}</strong><span>{item.message}</span><time>{stamp(item.createdAt)}</time></div>) : <p className="muted">{t("overview.noEvents")}</p>}{activity?.hasMore.events && <button className="button ghost history-more" onClick={onOlderActivity}>{t("overview.loadOlder")}</button>}</section>
  </div>;
}

const OTHER_PLAYER = "__other";
function Players({ worldId, players, known, sessions, moreSessions, reachable, onRefresh, onOlderSessions, onNotice }: { worldId: string; players: Array<Record<string, unknown>>; known: KnownPlayer[]; sessions: Activity["sessions"]; moreSessions: boolean; reachable: boolean; onRefresh(): void; onOlderSessions(): void; onNotice(message: string): void }) {
  const { t } = useTranslation(); const stamp = useLocaleDateTime(); const client = useQueryClient();
  const [target, setTarget] = useState(""); const [manualUserId, setManualUserId] = useState("");
  const online = new Set(playersFrom({ players }).map((player) => player.userId).filter(Boolean));
  const admin = useMutation({
    mutationFn: (payload: Record<string, unknown>) => json(`/api/worlds/${worldId}/admin`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (_, payload) => { const action = String(payload.action); const name = String(payload.playerName ?? payload.userId ?? "player"); onNotice(t(action === "kick" ? "players.kicked" : action === "ban" ? "players.banned" : "players.unbanned", { name })); onRefresh(); void client.invalidateQueries({ queryKey: ["world-players", worldId] }); },
    onError: (error) => onNotice(error.message),
  });
  function act(action: "kick" | "ban" | "unban", userId: string, name: string) {
    if (action !== "unban" && !window.confirm(t(action === "kick" ? "players.kickConfirm" : "players.banConfirm", { name }))) return;
    admin.mutate({ action, userId, playerName: name });
  }
  const selected = target === OTHER_PLAYER ? { userId: manualUserId.trim(), name: manualUserId.trim() } : known.find((player) => player.userId === target) ? { userId: target, name: known.find((player) => player.userId === target)!.playerName } : null;
  const canModerate = reachable && Boolean(selected?.userId) && !admin.isPending;
  return <div className="players-panel">
    <div className="panel-heading"><div><h2>{t("players.online")}</h2><p>{t("players.idHelp")}</p></div>{reachable && <button className="button ghost" onClick={onRefresh}>{t("common.refresh")}</button>}</div>
    {!reachable ? <div className="tab-empty compact"><p>{t("players.offlineHelp")}</p></div> : players.length ? <div className="player-table"><div className="player-table-head"><span>{t("players.player")}</span><span>{t("players.level")}</span><span>{t("players.ping")}</span><span>{t("players.location")}</span><span>{t("players.actions")}</span></div>{players.map((player, index) => { const userId = String(player.userId ?? player.userid ?? player.playerId ?? player.name ?? index); const name = String(player.name ?? player.playername ?? t("common.unknownPlayer")); return <div className="player-row" key={userId}><span><strong>{name}</strong><small>{String(player.accountName ?? player.accountname ?? userId)}</small></span><span>{String(player.level ?? "—")}</span><span>{player.ping == null ? "—" : `${Math.round(Number(player.ping))} ms`}</span><span>{player.location_x == null ? "—" : `${Math.round(Number(player.location_x))}, ${Math.round(Number(player.location_y))}`}</span><span className="player-actions"><button disabled={admin.isPending} onClick={() => act("kick", userId, name)}>{t("players.kick")}</button><button className="danger" disabled={admin.isPending} onClick={() => act("ban", userId, name)}>{t("players.ban")}</button></span></div>; })}</div> : <div className="tab-empty compact"><p>{t("players.none")}</p></div>}
    <section className="manual-moderation"><div><h2>{t("players.moderateTitle")}</h2><p>{t("players.moderateHelp")}</p></div><div className="moderation-target"><select aria-label={t("players.moderateTarget")} value={target} onChange={(event) => setTarget(event.target.value)}><option value="">{t("players.choosePlayer")}</option>{known.map((player) => <option key={player.userId} value={player.userId}>{player.playerName} ({player.userId})</option>)}<option value={OTHER_PLAYER}>{t("players.otherId")}</option></select>{target === OTHER_PLAYER && <input value={manualUserId} onChange={(event) => setManualUserId(event.target.value)} placeholder={t("players.userId")} />}</div><button disabled={!canModerate} title={reachable ? undefined : t("players.offlineHelp")} onClick={() => act("kick", selected!.userId, selected!.name)}>{t("players.kick")}</button><button className="danger" disabled={!canModerate} title={reachable ? undefined : t("players.offlineHelp")} onClick={() => act("ban", selected!.userId, selected!.name)}>{t("players.ban")}</button><button disabled={!canModerate} title={reachable ? undefined : t("players.offlineHelp")} onClick={() => act("unban", selected!.userId, selected!.name)}>{t("players.unban")}</button></section>
    <section className="players-known"><h2>{t("players.known")}</h2>{known.length ? <div className="record-list">{known.map((player) => <div key={player.userId}><span><strong>{player.playerName}{online.has(player.userId) && <em className="player-badge online">{t("players.onlineBadge")}</em>}{player.bannedAt && <em className="player-badge banned">{t("players.bannedBadge")}</em>}</strong><small>{player.userId}{player.accountName ? ` · ${player.accountName}` : ""}</small><small>{t("players.lastSeen", { date: stamp(player.lastSeenAt) })} · {t("players.joins", { count: player.joinCount })}</small></span></div>)}</div> : <p className="muted">{t("players.knownEmpty")}</p>}</section>
    <section className="players-history"><h2>{t("overview.sessions")}</h2>{sessions.length ? sessions.map((item) => <div className="history-row" key={item.id}><strong>{t(`events.kind.${item.event}`, { defaultValue: humanizeIdentifier(item.event) })}</strong><span>{item.playerName ?? t("common.unknownPlayer")}</span><time>{stamp(item.createdAt)}</time></div>) : <p className="muted">{t("overview.noSessions")}</p>}{moreSessions && <button className="button ghost history-more" onClick={onOlderSessions}>{t("overview.loadOlder")}</button>}</section>
  </div>;
}

function Deaths({ records, hasMore, onLoadOlder }: { records: Activity["deaths"]; hasMore: boolean; onLoadOlder(): void }) {
  const { t } = useTranslation(); const stamp = useLocaleDateTime();
  return <div><div className="panel-heading"><div><h2>{t("deaths.title")}</h2><p>{t("deaths.description")}</p></div></div>{records.length ? <div className="record-list">{records.map((item) => <div key={item.id}><span><strong>{item.victim}</strong><small>{item.killer ? `${item.cause ?? t("deaths.unknownCause")} · ${t(item.killerKind === "player" ? "deaths.killedByPlayer" : "deaths.killedBy")} ${item.killer}` : item.cause ?? t("deaths.unknownCause")}</small><small>{stamp(item.createdAt)}</small></span></div>)}</div> : <div className="tab-empty"><h2>{t("deaths.empty")}</h2><p>{t("deaths.emptyHelp")}</p></div>}{hasMore && <button className="button ghost history-more" onClick={onLoadOlder}>{t("overview.loadOlder")}</button>}</div>;
}
