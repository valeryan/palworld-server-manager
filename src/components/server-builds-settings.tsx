"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { BuildAction, BuildSummary } from "@/contracts/builds";
import { fetchJson, requestJson } from "@/lib/http-client";
import { useLocaleDateTime } from "@/lib/use-locale-format";
import { useNoticeAction } from "@/lib/use-notice-action";
import { BuildStatus } from "./build-status";
import { JobProgress } from "./job-progress";
import { SettingHelp } from "./setting-help";

// Settings → Server builds: the shared SteamCMD client, one Palworld build check for every world,
// and the update-all operation. Jobs it starts are manager-level and appear on the Operations page.

const summary = () => fetchJson<{ summary: BuildSummary }>("/api/runtime/builds");
const act = <T,>(action: BuildAction["action"]) => requestJson<T>("/api/runtime/builds", { method: "POST", body: JSON.stringify({ action }) });

export function ServerBuildsSettings({ onNotice }: { onNotice(message: string): void }) {
  const { t } = useTranslation(); const dateTime = useLocaleDateTime(); const client = useQueryClient();
  const query = useQuery({ queryKey: ["server-builds"], queryFn: summary, refetchInterval: (state) => state.state.data?.summary.activeJob ? 2_000 : 30_000 });
  const check = useNoticeAction(onNotice); const update = useNoticeAction(onNotice); const reinstall = useNoticeAction(onNotice);
  const data = query.data?.summary; const busy = Boolean(data?.activeJob) || check.pending || update.pending || reinstall.pending;
  const outdated = data?.worlds.filter((world) => world.state === "update-available") ?? [];
  const help = (labelKey: string, guidanceKey: string) => { const heading = t(labelKey); return <SettingHelp label={t("structured.helpFor", { setting: heading })} heading={heading} guidance={t(guidanceKey)} />; };
  async function refresh() { await Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ["worlds"] })]); }
  async function checkLatest() {
    await check.run(async () => {
      const { summary: next } = await act<{ summary: BuildSummary }>("check"); await refresh();
      const count = next.worlds.filter((world) => world.state === "update-available").length;
      onNotice(count ? t("settings.builds.checkedNotice", { build: next.latest?.buildId, count }) : t("settings.builds.allCurrentNotice", { build: next.latest?.buildId }));
    });
  }
  async function updateAll() {
    if (!window.confirm(t("settings.builds.updateAllConfirm", { count: outdated.length, names: outdated.map((world) => world.displayName).join("\n• ") }))) return;
    await update.run(async () => { await act("update-all"); onNotice(t("settings.builds.updateAllStarted")); await query.refetch(); });
  }
  async function reinstallClient() {
    if (!window.confirm(t("settings.builds.reinstallConfirm"))) return;
    await reinstall.run(async () => { await act("reinstall-steamcmd"); onNotice(t("settings.builds.reinstallStarted")); await query.refetch(); });
  }
  return <section id="server-builds" className="settings-builds">
    <div><h2>{t("settings.builds.title")}{help("settings.builds.title", "settings.builds.description")}</h2></div>
    <div className="build-rows">
      <div className="build-row"><span><strong>{t("settings.builds.steamcmd")}{help("settings.builds.steamcmd", "settings.builds.steamcmdHelp")}</strong><small>{data ? data.steamCmd.installed ? t("settings.builds.steamcmdReady", { date: data.steamCmd.preparedAt ? dateTime(data.steamCmd.preparedAt) : "—" }) : t("settings.builds.steamcmdMissing") : "…"}{data?.steamCmd.inUse ? ` · ${t("settings.builds.steamcmdInUse")}` : ""}</small><code>{data?.steamCmd.path}</code></span><button className="button danger" disabled={!data || busy} onClick={() => void reinstallClient()}>{t("settings.builds.reinstall")}</button></div>
      <div className="build-row"><span><strong>{t("settings.builds.latest")}{help("settings.builds.latest", "settings.builds.latestHelp")}</strong><small>{data?.latest ? t("settings.builds.latestValue", { build: data.latest.buildId, date: dateTime(data.latest.checkedAt) }) : t("settings.builds.latestUnknown")}</small></span><button className="button ghost" disabled={!data || busy} onClick={() => void checkLatest()}>{t(check.pending ? "settings.builds.checking" : "settings.builds.check")}</button></div>
    </div>
    <div className="language-list build-list">{data?.worlds.map((world) => <div key={world.id}><span><strong>{world.displayName}</strong><small>{world.buildId ? t("settings.builds.installed", { build: world.buildId }) : "—"}{world.busy ? ` · ${t("settings.builds.busy")}` : ""}</small></span><span className="build-cell"><BuildStatus installed={world.buildId} latest={world.latestBuildId} /><em className={`build-badge ${world.state}`}>{t(`settings.builds.state.${world.state}`)}</em></span></div>)}{data && !data.worlds.length && <div><span><small>{t("settings.builds.noWorlds")}</small></span></div>}</div>
    <div className="builds-footer"><p>{t("settings.builds.updateAllHelp")}</p><button className="button primary" disabled={!data || busy || !outdated.length} onClick={() => void updateAll()}>{t("settings.builds.updateAll")}</button>{data?.activeJob && <JobProgress jobId={data.activeJob.id} onFinished={(job) => { void refresh(); onNotice(job.error ?? job.message); }} />}</div>
  </section>;
}
