import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

const sourceDatabase = option("--source-db"); const targetDatabase = option("--target-db"); const mappingsPath = option("--mappings"); const reportPath = option("--report");
if (!sourceDatabase || !targetDatabase || !mappingsPath || !reportPath) throw new Error("Candidate import requires --source-db, --target-db, --mappings, and --report.");
process.env.PALWORLD_MANAGER_DB = path.resolve(targetDatabase);
process.env.PALWORLD_MANAGER_DATA_DIR = path.dirname(path.resolve(targetDatabase));
const mappings = JSON.parse(await readFile(path.resolve(mappingsPath), "utf8")) as Record<string, string>;
const { importLegacyDatabase } = await import("../src/server/services/legacy-import");
const report = await importLegacyDatabase(path.resolve(sourceDatabase), mappings);
await writeFile(path.resolve(reportPath), JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
