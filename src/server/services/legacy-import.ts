import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import AdmZip from "adm-zip";
import { createWorldSchema } from "@/contracts/world";
import { sqliteClient } from "@/server/db";
import { pathsOverlap } from "./worlds";

type LegacyRow = Record<string, unknown>;
type ImportCounts = Record<string, number>;
export interface ImportReport {
  source: string;
  sourceHash: string;
  imported: string[];
  skipped: string[];
  invalid: string[];
  defaulted: string[];
  deferredTables: string[];
  counts: ImportCounts;
  verification: { worldCount: number; relationshipErrors: number; criticalFieldsPresent: boolean };
}

function bool(value: unknown, fallback = false): boolean { return value == null ? fallback : Number(value) !== 0; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function nullableText(value: unknown): string | null { const valueText = text(value); return valueText || null; }
function num(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function nullableNum(value: unknown): number | null { const parsed = Number(value); return value == null || !Number.isFinite(parsed) ? null : parsed; }
function jsonObject(value: unknown): Record<string, string> { try { const parsed = JSON.parse(text(value, "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function settingValue(value: unknown): unknown { try { return JSON.parse(text(value, "null")); } catch { return value; } }
function mappedPath(value: unknown, mappings: Record<string, string>): string {
  const original = text(value);
  const exact = mappings[original];
  if (exact) return exact;
  const prefix = Object.entries(mappings).find(([source]) => original === source || original.startsWith(`${source}${path.sep}`));
  return prefix ? path.join(prefix[1], path.relative(prefix[0], original)) : original;
}
function rows(snapshot: Record<string, unknown>, table: string): LegacyRow[] { return Array.isArray(snapshot[table]) ? snapshot[table] as LegacyRow[] : []; }

async function archiveIsValid(filePath: string): Promise<boolean> {
  try { const info = await stat(filePath); return info.isFile() && new AdmZip(filePath).test(); } catch { return false; }
}

export async function importLegacyDatabase(sourcePath: string, pathMappings: Record<string, string> = {}): Promise<ImportReport> {
  const source = await realpath(path.resolve(/* turbopackIgnore: true */ sourcePath));
  if (process.env.PALWORLD_MANAGER_DB && source === path.resolve(/* turbopackIgnore: true */ process.env.PALWORLD_MANAGER_DB)) throw new Error("Legacy source cannot be the active database.");
  const info = await stat(source);
  if (!info.isFile()) throw new Error("Legacy database path is not a file.");
  const sourceHash = createHash("sha256").update(await readFile(source)).digest("hex");
  const legacy = new DatabaseSync(source, { readOnly: true, timeout: 5_000 });
  let snapshot: Record<string, unknown>;
  let tables: string[];
  try {
    const integrity = legacy.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== "ok") throw new Error("Legacy database failed SQLite integrity_check.");
    tables = (legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name);
    if (!tables.includes("worlds")) throw new Error("Legacy database does not contain a worlds table.");
    snapshot = {};
    for (const table of tables) if (/^[a-zA-Z0-9_]+$/.test(table)) snapshot[table] = legacy.prepare(`SELECT * FROM "${table}"`).all();
  } finally { legacy.close(); }

  const worldRows = rows(snapshot, "worlds");
  const report: ImportReport = {
    source, sourceHash, imported: [], skipped: [], invalid: [], defaulted: [],
    deferredTables: tables.filter((name) => ["discord_actions", "remote_codes", "remote_sessions", "remote_audit"].includes(name)),
    counts: {}, verification: { worldCount: 0, relationshipErrors: 0, criticalFieldsPresent: false },
  };
  const preparedWorlds = worldRows.map((row) => {
    const id = text(row.world_id);
    if (!id) throw new Error("Legacy world row is missing world_id.");
    const input = createWorldSchema.parse({
      displayName: text(row.display_name, id), installDir: mappedPath(row.install_dir, pathMappings), platform: text(row.platform, process.platform === "win32" ? "windows" : "linux"),
      gamePort: num(row.game_port, 8211), queryPort: num(row.query_port, 27015), restApiPort: num(row.rest_api_port, 8212), rconPort: num(row.rcon_port, 25575),
      adminPassword: text(row.admin_password), serverPassword: text(row.server_password), restApiEnabled: bool(row.rest_api_enabled, true), rconEnabled: bool(row.rcon_enabled),
      communityServer: bool(row.community_server), autostart: false, crashGuard: bool(row.crash_guard, true), legacyPerfFlags: bool(row.legacy_perf_flags, true),
      extraArgs: text(row.extra_args), env: jsonObject(row.env_vars), wineBinary: text(row.wine_binary, "wine"), winePrefix: nullableText(row.wine_prefix), wineLaunchFlags: text(row.wine_launch_flags),
    });
    if (!path.isAbsolute(input.installDir)) throw new Error(`World ${id} has a non-absolute install directory.`);
    if (row.server_password == null) report.defaulted.push(`${id}.server_password`);
    return { id, row, input };
  });
  for (let index = 0; index < preparedWorlds.length; index += 1) {
    for (let other = index + 1; other < preparedWorlds.length; other += 1) {
      const left = preparedWorlds[index]!; const right = preparedWorlds[other]!;
      if (pathsOverlap(left.input.installDir, right.input.installDir)) throw new Error(`World install directories overlap: ${left.id} and ${right.id}.`);
      const leftPorts = [left.input.gamePort, left.input.queryPort, left.input.restApiPort, left.input.rconPort];
      const rightPorts = [right.input.gamePort, right.input.queryPort, right.input.restApiPort, right.input.rconPort];
      const collision = leftPorts.find((port) => rightPorts.includes(port));
      if (collision) throw new Error(`Port ${collision} is shared by ${left.id} and ${right.id}.`);
    }
  }

  const backupVerification = new Map<string, boolean>();
  for (const row of rows(snapshot, "backups")) backupVerification.set(text(row.id), await archiveIsValid(mappedPath(row.file_path, pathMappings)));
  const client = sqliteClient();
  const existingWorlds = (client.prepare("SELECT count(*) count FROM worlds").get() as { count: number }).count;
  if (existingWorlds !== 0) throw new Error("Legacy import requires a fresh target database; refusing to merge into an existing world registry.");

  client.exec("BEGIN IMMEDIATE");
  try {
    const insertWorld = client.prepare(`INSERT INTO worlds (id,display_name,install_dir,platform,game_port,query_port,rest_api_port,rcon_port,admin_password,server_password,rest_api_enabled,rcon_enabled,community_server,autostart,crash_guard,legacy_perf_flags,extra_args,environment,wine_binary,wine_prefix,wine_launch_flags,status,process_id,build_id,latest_build_id,last_started_at,crash_count,mods_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'stopped',NULL,?,?,?,?,?,?,?)`);
    for (const { id, row, input } of preparedWorlds) {
      const createdAt = num(row.created_at, Date.now());
      insertWorld.run(id, input.displayName, input.installDir, input.platform, input.gamePort, input.queryPort, input.restApiPort, input.rconPort, input.adminPassword, input.serverPassword, Number(input.restApiEnabled), Number(input.rconEnabled), Number(input.communityServer), 0, Number(input.crashGuard), Number(input.legacyPerfFlags), input.extraArgs, JSON.stringify(input.env), input.wineBinary, input.winePrefix, input.wineLaunchFlags, nullableText(row.build_id), nullableText(row.latest_known_build_id), nullableNum(row.last_started_at), num(row.crash_count, 0), Number(bool(row.mods_enabled)), createdAt, createdAt);
      report.imported.push(id);
    }

    const tableImporters: Record<string, (row: LegacyRow) => void> = {
      events: (row) => client.prepare("INSERT INTO events (id,world_id,kind,message,metadata,created_at) VALUES (?,?,?,?,NULL,?)").run(num(row.id, 0), nullableText(row.world_id), text(row.kind, "legacy"), text(row.message), num(row.created_at, Date.now())),
      backups: (row) => client.prepare("INSERT INTO backups (id,world_id,file_path,size_bytes,reason,verified,created_at) VALUES (?,?,?,?,?,?,?)").run(text(row.id), text(row.world_id), mappedPath(row.file_path, pathMappings), num(row.size_bytes, 0), text(row.reason, "legacy"), Number(backupVerification.get(text(row.id)) ?? false), num(row.created_at, Date.now())),
      schedules: (row) => client.prepare("INSERT INTO schedules (id,world_id,action,mode,interval_hours,interval_minutes,time_of_day,message,join_match,join_delay_seconds,enabled,skip_next,last_run_at,next_run_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)").run(text(row.id), text(row.world_id), text(row.job_type), text(row.mode), nullableNum(row.interval_hours), nullableNum(row.interval_minutes), nullableText(row.time_of_day), nullableText(row.message), nullableText(row.join_match), nullableNum(row.join_delay_seconds), 0, Number(bool(row.skip_next)), nullableNum(row.last_run), num(row.created_at, Date.now())),
      sessions: (row) => client.prepare("INSERT INTO sessions (id,world_id,user_id,player_name,event,created_at) VALUES (?,?,?,?,?,?)").run(num(row.id, 0), text(row.world_id), nullableText(row.user_id), nullableText(row.player_name), text(row.event), num(row.created_at, Date.now())),
      deaths: (row) => client.prepare("INSERT INTO deaths (id,world_id,victim,cause,killer,killer_raw,killer_kind,created_at) VALUES (?,?,?,?,?,?,?,?)").run(num(row.id, 0), text(row.world_id), text(row.victim), nullableText(row.cause), nullableText(row.killer), nullableText(row.killer_raw), nullableText(row.killer_kind), num(row.created_at, Date.now())),
      ini_versions: (row) => client.prepare("INSERT INTO config_versions (id,world_id,file_name,content,note,created_at) VALUES (?,?,?,?,?,?)").run(`legacy-${num(row.id, 0)}`, text(row.world_id), "PalWorldSettings.ini", text(row.content), nullableText(row.note), num(row.created_at, Date.now())),
      mods: (row) => client.prepare("INSERT INTO mods (id,world_id,package_name,display_name,workshop_id,version,source,folder,server_only,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(text(row.id), text(row.world_id), text(row.package_name), nullableText(row.display_name), nullableText(row.workshop_id), nullableText(row.version), nullableText(row.source), nullableText(row.folder), Number(bool(row.is_server, true)), Number(bool(row.enabled, true)), num(row.created_at, Date.now())),
      app_settings: (row) => client.prepare("INSERT INTO app_settings (key,value) VALUES (?,?)").run(text(row.key), JSON.stringify(settingValue(row.value))),
    };
    for (const [table, importer] of Object.entries(tableImporters)) {
      const tableRows = rows(snapshot, table);
      for (const row of tableRows) importer(row);
      report.counts[table] = tableRows.length;
    }
    report.counts.worlds = preparedWorlds.length;
    report.verification.worldCount = (client.prepare("SELECT count(*) count FROM worlds").get() as { count: number }).count;
    report.verification.relationshipErrors = (client.prepare(`SELECT (SELECT count(*) FROM events e LEFT JOIN worlds w ON w.id=e.world_id WHERE e.world_id IS NOT NULL AND w.id IS NULL) + (SELECT count(*) FROM backups b LEFT JOIN worlds w ON w.id=b.world_id WHERE w.id IS NULL) + (SELECT count(*) FROM sessions s LEFT JOIN worlds w ON w.id=s.world_id WHERE w.id IS NULL) count`).get() as { count: number }).count;
    report.verification.criticalFieldsPresent = (client.prepare("SELECT count(*) count FROM worlds WHERE id='' OR display_name='' OR install_dir='' OR game_port IS NULL").get() as { count: number }).count === 0;
    if (report.verification.worldCount !== worldRows.length || report.verification.relationshipErrors !== 0 || !report.verification.criticalFieldsPresent) throw new Error("Legacy import verification failed.");
    client.prepare("INSERT INTO legacy_imports (id,source_path,source_hash,snapshot,report,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), source, sourceHash, JSON.stringify(snapshot), JSON.stringify(report), Date.now());
    client.exec("COMMIT");
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
  return report;
}
