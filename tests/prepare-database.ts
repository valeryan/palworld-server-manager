import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { runDatabasePreflight } from "@/server/db/upgrade";

export async function prepareTestDatabase(dataDirectory: string, databasePath = path.join(dataDirectory, "registry-v3.sqlite")) {
  await runDatabasePreflight({ databasePath, dataDirectory, migrationsFolder: path.join(process.cwd(), "drizzle") });
}

// Shared by the twelve suites that each need their own scratch directory and database: mkdtemp a
// directory, point PALWORLD_MANAGER_DATA_DIR/PALWORLD_MANAGER_DB at it (optionally under a subfolder,
// matching each file's original layout), prepare the database, and clean up afterward. Call before
// any other beforeAll/afterAll in the same describe scope so extra file-specific setup/teardown
// (which runs via vitest's FIFO beforeAll / LIFO afterAll ordering) layers around this correctly.
export function setupTestDataDirectory(prefix: string, options: { closeDatabase?: boolean; dataSubdir?: string | false; passDatabasePath?: boolean } = {}) {
  const { closeDatabase = false, dataSubdir = "data", passDatabasePath = true } = options;
  let directory = "";
  let dataDirectory = "";
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), prefix));
    dataDirectory = dataSubdir ? path.join(directory, dataSubdir) : directory;
    process.env.PALWORLD_MANAGER_DATA_DIR = dataDirectory;
    process.env.PALWORLD_MANAGER_DB = path.join(dataDirectory, "registry-v3.sqlite");
    if (passDatabasePath) await prepareTestDatabase(dataDirectory, process.env.PALWORLD_MANAGER_DB);
    else await prepareTestDatabase(dataDirectory);
  });
  afterAll(async () => {
    if (closeDatabase) {
      const { sqliteClient } = await import("@/server/db");
      sqliteClient().close();
      globalThis.__psmDatabase = undefined;
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { get directory() { return directory; }, get dataDirectory() { return dataDirectory; } };
}
