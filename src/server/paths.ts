import "server-only";
import path from "node:path";
import { mkdirSync } from "node:fs";

function ensure(directory: string): string { mkdirSync(directory, { recursive: true }); return directory; }
export function dataDirectory(): string { return ensure(path.resolve(/* turbopackIgnore: true */ process.env.PALWORLD_MANAGER_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data-next"))); }
export const paths = {
  data: dataDirectory,
  database: () => process.env.PALWORLD_MANAGER_DB || path.join(/* turbopackIgnore: true */ dataDirectory(), "registry-v3.sqlite"),
  steamCmd: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "steamcmd")),
  logs: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "logs")),
  worldLogs: (worldId: string) => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "logs", worldId)),
  backups: (worldId: string) => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "backups", worldId)),
  imports: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "imports")),
  languagePacks: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "language-packs")),
  // Not created eagerly: wineboot must initialize an absent prefix itself.
  winePrefix: (worldId: string) => path.join(/* turbopackIgnore: true */ dataDirectory(), "wine-prefixes", worldId),
  modCache: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "mod-library")),
  // Files moved aside when PSM takes over or removes a mod; never deleted automatically.
  modTrash: (worldId: string) => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "mod-trash", worldId)),
  // Inside the library so a verified download is moved into place by same-filesystem rename.
  modStaging: () => ensure(path.join(/* turbopackIgnore: true */ dataDirectory(), "mod-library", ".staging")),
};
