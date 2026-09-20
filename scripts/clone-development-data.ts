import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function repeated(name: string): string[] { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]!] : []); }
function overlaps(left: string, right: string) { const a = path.relative(left, right); const b = path.relative(right, left); return a === "" || (!a.startsWith("..") && !path.isAbsolute(a)) || (!b.startsWith("..") && !path.isAbsolute(b)); }
async function copyTree(source: string, destination: string) { await new Promise<void>((resolve, reject) => { const child = spawn("cp", ["--archive", "--reflink=auto", source, destination], { stdio: "inherit" }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`cp exited with ${code}`))); }); }

const sourceDbArg = option("--source-db"); const destinationArg = option("--destination"); const worldArgs = repeated("--world");
if (!sourceDbArg || !destinationArg || worldArgs.length === 0) throw new Error("Usage: npm run clone:dev-data -- --source-db /path/registry.sqlite --destination /path/sandbox --world name=/path/server [--world name=/path/server]");
const sourceDb = await realpath(path.resolve(sourceDbArg)); const destination = path.resolve(destinationArg);
try { await stat(destination); throw new Error(`Destination already exists; refusing to merge or overwrite: ${destination}`); } catch (error) { if (error instanceof Error && !error.message.includes("ENOENT") && !error.message.startsWith("Destination")) throw error; if (error instanceof Error && error.message.startsWith("Destination")) throw error; }
const sources = await Promise.all(worldArgs.map(async (entry) => { const split = entry.indexOf("="); if (split < 1) throw new Error(`Invalid --world value: ${entry}`); return { name: entry.slice(0, split), source: await realpath(path.resolve(entry.slice(split + 1))) }; }));
for (const item of sources) { if (overlaps(item.source, destination)) throw new Error(`Destination overlaps source server directory: ${item.source}`); }
if (overlaps(path.dirname(sourceDb), destination)) throw new Error("Destination overlaps the legacy database directory.");
await mkdir(path.join(destination, "legacy"), { recursive: true }); await mkdir(path.join(destination, "servers"), { recursive: true });
const copiedDb = path.join(destination, "legacy", "registry.sqlite"); const source = new DatabaseSync(sourceDb, { readOnly: true });
try { const result = source.prepare("PRAGMA integrity_check").get() as { integrity_check?: string }; if (result.integrity_check !== "ok") throw new Error("Source database failed integrity_check."); await backup(source, copiedDb); } finally { source.close(); }
const copied = new DatabaseSync(copiedDb); const mappings: Record<string, string> = {};
try {
  for (const item of sources) { const target = path.join(destination, "servers", item.name); await copyTree(item.source, target); mappings[item.source] = target; copied.prepare("UPDATE worlds SET install_dir=?, process_id=NULL, status='stopped', autostart=0 WHERE install_dir=?").run(target, item.source); }
  const columns = (copied.prepare("PRAGMA table_info(worlds)").all() as { name: string }[]).map((item) => item.name);
  for (const column of ["discord_webhook", "discord_webhooks", "discord_bot"] as const) if (columns.includes(column)) copied.exec(`UPDATE worlds SET ${column}=${column === "discord_webhook" ? "''" : "NULL"}`);
  if ((copied.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='schedules'").get() as { count: number }).count) copied.exec("UPDATE schedules SET enabled=0");
  if ((copied.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='remote_sessions'").get() as { count: number }).count) copied.exec("DELETE FROM remote_sessions");
  if ((copied.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='remote_codes'").get() as { count: number }).count) copied.exec("UPDATE remote_codes SET enabled=0");
  copied.exec("PRAGMA wal_checkpoint(TRUNCATE)");
} finally { copied.close(); }
await writeFile(path.join(destination, "DEVELOPMENT-SANDBOX.json"), JSON.stringify({ createdAt: new Date().toISOString(), sourceDatabase: sourceDb, copiedDatabase: copiedDb, pathMappings: mappings, externalSideEffectsDisabled: true }, null, 2));
console.log(JSON.stringify({ destination, copiedDb, mappings }, null, 2));
