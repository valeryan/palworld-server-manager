import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";

function ensure(directory: string): string { mkdirSync(directory, { recursive: true }); return directory; }
export function dataDirectory(): string { return ensure(path.resolve(/* turbopackIgnore: true */ process.env.PALWORLD_MANAGER_DATA_DIR || path.join(process.cwd(), ".data-next"))); }
export const paths = {
  data: dataDirectory,
  database: () => process.env.PALWORLD_MANAGER_DB || path.join(/* turbopackIgnore: true */ dataDirectory(), "registry-v3.sqlite"),
  steamCmd: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "steamcmd")),
  logs: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "logs")),
  worldLogs: (worldId: string) => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "logs", worldId)),
  backups: (worldId: string) => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "backups", worldId)),
  imports: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "imports")),
  languagePacks: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "language-packs")),
  modCache: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "mod-library")),
  // Inside the library so a verified download is moved into place by same-filesystem rename.
  modStaging: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "mod-library", ".staging")),
};
