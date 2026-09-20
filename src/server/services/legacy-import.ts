import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { database } from "@/server/db";
import { legacyImports } from "@/server/db/schema";
import { createWorld, getWorld } from "./worlds";

type LegacyRow = Record<string, unknown>;
export interface ImportReport { source: string; imported: string[]; skipped: string[]; invalid: string[]; deferredTables: string[]; }

function bool(value: unknown, fallback = false): boolean { return value == null ? fallback : Number(value) !== 0; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function num(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function jsonObject(value: unknown): Record<string, string> { try { const parsed = JSON.parse(text(value, "{}")); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } }

export async function importLegacyDatabase(sourcePath: string, pathMappings: Record<string, string> = {}): Promise<ImportReport> {
  const source = await realpath(path.resolve(/* turbopackIgnore: true */ sourcePath));
  if (process.env.PALWORLD_MANAGER_DB && source === path.resolve(/* turbopackIgnore: true */ process.env.PALWORLD_MANAGER_DB)) throw new Error("Legacy source cannot be the active database.");
  const info = await stat(source); if (!info.isFile()) throw new Error("Legacy database path is not a file.");
  const sourceHash = createHash("sha256").update(await readFile(source)).digest("hex");
  const legacy = new DatabaseSync(source, { readOnly: true, timeout: 5_000 });
  try {
    const integrity = legacy.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== "ok") throw new Error("Legacy database failed SQLite integrity_check.");
    const tables = (legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name);
    if (!tables.includes("worlds")) throw new Error("Legacy database does not contain a worlds table.");
    const snapshot: Record<string, unknown> = {};
    for (const table of tables) {
      if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;
      snapshot[table] = legacy.prepare(`SELECT * FROM "${table}"`).all();
    }
    const report: ImportReport = { source, imported: [], skipped: [], invalid: [], deferredTables: tables.filter((name) => ["discord_actions", "remote_codes", "remote_sessions", "remote_audit"].includes(name)) };
    for (const row of snapshot.worlds as LegacyRow[]) {
      const id = text(row.world_id);
      if (!id) { report.invalid.push("World row without world_id"); continue; }
      if (await getWorld(id)) { report.skipped.push(id); continue; }
      const originalDir = text(row.install_dir); const installDir = pathMappings[originalDir] ?? originalDir;
      try {
        const imported = await createWorld({
          displayName: text(row.display_name, id), installDir, platform: text(row.platform, process.platform === "win32" ? "windows" : "linux"),
          gamePort: num(row.game_port, 8211), queryPort: num(row.query_port, 27015), restApiPort: num(row.rest_api_port, 8212), rconPort: num(row.rcon_port, 25575),
          adminPassword: text(row.admin_password), serverPassword: text(row.server_password), restApiEnabled: bool(row.rest_api_enabled, true), rconEnabled: bool(row.rcon_enabled),
          communityServer: bool(row.community_server), autostart: false, crashGuard: bool(row.crash_guard, true), legacyPerfFlags: bool(row.legacy_perf_flags, true),
          extraArgs: text(row.extra_args), env: jsonObject(row.env_vars), wineBinary: text(row.wine_binary, "wine"), winePrefix: text(row.wine_prefix) || null, wineLaunchFlags: text(row.wine_launch_flags),
        });
        if (imported.id !== id) {
          const client = (await import("@/server/db")).sqliteClient();
          client.prepare("UPDATE worlds SET id=? WHERE id=?").run(id, imported.id);
        }
        report.imported.push(id);
      } catch (error) { report.invalid.push(`${id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    await database().insert(legacyImports).values({ id: randomUUID(), sourcePath: source, sourceHash, snapshot, report: report as unknown as Record<string, unknown>, createdAt: Date.now() });
    return report;
  } finally { legacy.close(); }
}
