import "server-only";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { paths } from "@/server/paths";
import { databaseWasPrepared } from "./upgrade";

function createDatabase() {
  const databasePath = paths.database();
  if (!databaseWasPrepared(databasePath)) throw new Error("Database startup preflight has not completed.");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const client = new DatabaseSync(databasePath, { timeout: 5_000 });
  chmodSync(databasePath, 0o600);
  client.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  for (const relatedPath of [`${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(/* turbopackIgnore: true */ relatedPath)) chmodSync(/* turbopackIgnore: true */ relatedPath, 0o600);
  }
  const database = drizzle({ client });
  return { database, client, databasePath };
}
type DatabaseBundle = ReturnType<typeof createDatabase>;
declare global { var __psmDatabase: DatabaseBundle | undefined; }
function bundle() { globalThis.__psmDatabase ??= createDatabase(); return globalThis.__psmDatabase; }
export const database = () => bundle().database;
export const sqliteClient = () => bundle().client;
export const databasePath = () => bundle().databasePath;
