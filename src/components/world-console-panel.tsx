"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorldView } from "@/contracts/world";
import { requestJson } from "@/lib/http-client";

export type WorldLogs = {
  files: string[];
  selected: string | null;
  sizeBytes?: number;
  content: string;
};

type Props = {
  world: Pick<WorldView, "id" | "status" | "restApiEnabled" | "rconEnabled">;
  logs?: WorldLogs;
  paused: boolean;
  onPause(): void;
  onSelect(file: string): void;
  onRefresh(): void;
  onNotice(message: string): void;
};

export function WorldConsolePanel({ world, logs, paused, onPause, onSelect, onRefresh, onNotice }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [rconCommand, setRconCommand] = useState("");
  const [rconOutput, setRconOutput] = useState("");
  const admin = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson(`/api/worlds/${world.id}/admin`, {
      method: "POST", body: JSON.stringify(payload),
    }),
    onSuccess: (_, payload) => {
      if (payload.action === "announce") {
        setAnnouncement("");
        onNotice(t("console.announcementSent"));
      } else onNotice(t("console.saveRequested"));
    },
    onError: (error) => onNotice(error.message),
  });
  const rcon = useMutation({
    mutationFn: (command: string) => requestJson<{ output: string }>(`/api/worlds/${world.id}/rcon`, {
      method: "POST", body: JSON.stringify({ command }),
    }),
    onSuccess: ({ output }, command) => {
      setRconOutput(`> ${command}\n${output || t("console.noResponse")}`);
      setRconCommand("");
    },
    onError: (error) => {
      setRconOutput(t("console.error", { error: error.message }));
      onNotice(error.message);
    },
  });

  const needle = search.trim().toLocaleLowerCase();
  const lines = (logs?.content ?? "").split("\n");
  const matches = needle ? lines.filter((line) => line.toLocaleLowerCase().includes(needle)) : lines;
  const shown = matches.join("\n");

  return <div className="console-panel">
    <div className="panel-heading">
      <div>
        <h2>{t("console.title")}</h2>
        <p>{logs?.selected ?? t("console.noLog")}{logs?.sizeBytes && logs.sizeBytes > 250_000 ? ` · ${t("console.newest")}` : ""}</p>
      </div>
      <div className="console-heading-actions">
        <button className={`button ${paused ? "primary" : "ghost"}`} onClick={onPause}>
          {t(paused ? "console.resume" : "console.pause")}
        </button>
        <button className="button ghost" onClick={onRefresh}>{t("console.refresh")}</button>
      </div>
    </div>
    <div className="console-tools">
      <label>{t("console.logFile")}
        <select value={logs?.selected ?? ""} onChange={(event) => onSelect(event.target.value)} disabled={!logs?.files.length}>
          {(logs?.files ?? []).map((file) => <option key={file}>{file}</option>)}
        </select>
      </label>
      <label>{t("console.search")}
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("console.searchPlaceholder")} />
      </label>
      {logs?.selected && <a className="button ghost" href={`/api/worlds/${world.id}/logs/download?file=${encodeURIComponent(logs.selected)}`}>
        {t("console.download")}
      </a>}
      <span>{needle ? t("console.matches", { count: matches.length }) : t(paused ? "console.paused" : "console.updating")}</span>
    </div>
    <pre className="console-output">{shown || t(needle ? "console.noMatches" : "console.waiting")}</pre>

    <section className="live-admin">
      <div><h2>{t("console.adminTitle")}</h2><p>{t("console.adminDescription")}</p></div>
      <div className="announce-row">
        <input value={announcement} maxLength={2_000} onChange={(event) => setAnnouncement(event.target.value)}
          placeholder={t("console.announcement")} disabled={world.status !== "running" || !world.restApiEnabled} />
        <button className="button primary" disabled={!announcement.trim() || admin.isPending || world.status !== "running" || !world.restApiEnabled}
          onClick={() => admin.mutate({ action: "announce", message: announcement })}>{t("console.send")}</button>
        <button className="button ghost" disabled={admin.isPending || world.status !== "running" || !world.restApiEnabled}
          onClick={() => admin.mutate({ action: "save" })}>{t("console.saveWorld")}</button>
      </div>
      {!world.restApiEnabled && <p className="form-warning">{t("console.restDisabled")}</p>}
    </section>

    {world.rconEnabled && <section className="legacy-rcon">
      <div><h2>{t("console.rconTitle")}</h2><p>{t("console.rconDescription")}</p></div>
      <div className="announce-row">
        <input value={rconCommand} onChange={(event) => setRconCommand(event.target.value)}
          placeholder={t("console.rconPlaceholder")} disabled={world.status !== "running"}
          onKeyDown={(event) => {
            if (event.key === "Enter" && rconCommand.trim() && !rcon.isPending) rcon.mutate(rconCommand);
          }} />
        <button className="button ghost" disabled={!rconCommand.trim() || rcon.isPending || world.status !== "running"}
          onClick={() => rcon.mutate(rconCommand)}>{t(rcon.isPending ? "console.running" : "console.run")}</button>
      </div>
      {rconOutput && <pre className="rcon-output">{rconOutput}</pre>}
    </section>}
  </div>;
}
