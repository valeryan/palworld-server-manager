import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
const hashFile = async (filePath: string) => createHash("sha256").update(await readFile(filePath)).digest("hex");
async function runCandidate(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cli = path.resolve("node_modules/tsx/dist/cli.mjs");
    const child = spawn(process.execPath, [cli, "--tsconfig", path.resolve("tsconfig.scripts.json"), path.resolve("scripts/import-legacy-candidate.ts"), ...args], { cwd: process.cwd(), stdio: "inherit" });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Candidate importer exited with ${code}`)));
  });
}
function validateDatabase(filePath: string, expectedWorlds: number) {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    const worlds = (database.prepare("SELECT count(*) count FROM worlds").get() as { count: number }).count;
    const invalid = (database.prepare("SELECT count(*) count FROM worlds WHERE status <> 'stopped' OR process_id IS NOT NULL OR autostart <> 0").get() as { count: number }).count;
    if (integrity.integrity_check !== "ok" || worlds !== expectedWorlds || invalid !== 0) throw new Error("Candidate database validation failed.");
    return worlds;
  } finally { database.close(); }
}

const sourceArg = option("--source-db"); const manifestArg = option("--sandbox-manifest");
if (!sourceArg || !manifestArg) throw new Error("Usage: npm run rehearse:import -- --source-db /path/registry.sqlite --sandbox-manifest /path/DEVELOPMENT-SANDBOX.json");
const source = await realpath(path.resolve(sourceArg)); const manifestPath = await realpath(path.resolve(manifestArg));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { sourceDatabase?: string; pathMappings?: Record<string, string> };
if (!manifest.pathMappings || !Object.keys(manifest.pathMappings).length) throw new Error("Sandbox manifest does not contain path mappings.");
if (manifest.sourceDatabase && await realpath(manifest.sourceDatabase) !== source) throw new Error("Sandbox manifest belongs to a different source database.");
const sourceBefore = await hashFile(source); const sourceDatabase = new DatabaseSync(source, { readOnly: true });
let expectedWorlds: number;
try { expectedWorlds = (sourceDatabase.prepare("SELECT count(*) count FROM worlds").get() as { count: number }).count; } finally { sourceDatabase.close(); }

const rehearsal = await mkdtemp(path.join(tmpdir(), "psm-next-import-rehearsal-"));
try {
  const stage = path.join(rehearsal, "stage"); const production = path.join(rehearsal, "production"); await mkdir(stage); await mkdir(production);
  const candidate = path.join(stage, "registry-v3.sqlite"); const active = path.join(production, "registry-v3.sqlite"); const rollback = path.join(production, "registry-v3.rollback.sqlite");
  const mappings = path.join(rehearsal, "mappings.json"); const report = path.join(rehearsal, "report.json");
  await writeFile(mappings, JSON.stringify(manifest.pathMappings), { encoding: "utf8", mode: 0o600 });
  const baseline = new DatabaseSync(active); baseline.exec("CREATE TABLE rollback_marker (value TEXT NOT NULL); INSERT INTO rollback_marker VALUES ('known-good');"); baseline.close();
  const baselineHash = await hashFile(active);
  await runCandidate(["--source-db", source, "--target-db", candidate, "--mappings", mappings, "--report", report]);
  const importedWorlds = validateDatabase(candidate, expectedWorlds);
  const importReport = JSON.parse(await readFile(report, "utf8")) as { verification?: { relationshipErrors?: number; criticalFieldsPresent?: boolean } };
  if (importReport.verification?.relationshipErrors !== 0 || importReport.verification.criticalFieldsPresent !== true) throw new Error("Candidate import report did not pass critical verification.");

  await rename(active, rollback); await rename(candidate, active);
  validateDatabase(active, expectedWorlds);
  await rename(active, candidate); await rename(rollback, active);
  if (await hashFile(active) !== baselineHash) throw new Error("Rollback did not restore the known-good database byte for byte.");
  const restored = new DatabaseSync(active, { readOnly: true });
  try { if ((restored.prepare("SELECT value FROM rollback_marker").get() as { value?: string }).value !== "known-good") throw new Error("Rollback marker was not restored."); } finally { restored.close(); }
  if (await hashFile(source) !== sourceBefore) throw new Error("The legacy source database changed during rehearsal.");
  console.log(JSON.stringify({ ok: true, importedWorlds, sourceHash: sourceBefore, activation: "validated", rollback: "byte-for-byte restored", temporaryFilesRemoved: true }, null, 2));
} finally { await rm(rehearsal, { recursive: true, force: true }); }
