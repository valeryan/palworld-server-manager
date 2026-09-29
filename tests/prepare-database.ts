import path from "node:path";
import { runDatabasePreflight } from "@/server/db/upgrade";

export async function prepareTestDatabase(dataDirectory: string, databasePath = path.join(dataDirectory, "registry-v3.sqlite")) {
  await runDatabasePreflight({ databasePath, dataDirectory, migrationsFolder: path.join(process.cwd(), "drizzle") });
}
