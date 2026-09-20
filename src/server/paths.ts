import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";

function ensure(directory: string): string { mkdirSync(directory, { recursive: true }); return directory; }
export function dataDirectory(): string { return ensure(path.resolve(/* turbopackIgnore: true */ process.env.PALWORLD_MANAGER_DATA_DIR || path.join(process.cwd(), ".data-next"))); }
export const paths = {
  data: dataDirectory,
  database: () => process.env.PALWORLD_MANAGER_DB || path.join(dataDirectory(), "registry-v3.sqlite"),
  steamCmd: () => ensure(path.join(dataDirectory(), "steamcmd")),
  logs: () => ensure(path.join(dataDirectory(), "logs")),
  worldLogs: (worldId: string) => ensure(path.join(dataDirectory(), "logs", worldId)),
  backups: (worldId: string) => ensure(path.join(dataDirectory(), "backups", worldId)),
  imports: () => ensure(path.join(dataDirectory(), "imports")),
};
