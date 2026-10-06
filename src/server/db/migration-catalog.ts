import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Until 1.0.0 the schema is still taking shape, so the history is one baseline migration that may
// be regenerated; databases from earlier development builds are refused and must be deleted.
export const releasedMigrations = [
  { name: "20261006055351_initial", hash: "0f8bdca5db23ba9ab34aa8549c77adbd7ea9dacf67885e0fdff4e2ba44ea0fbe" },
] as const;

export type MigrationCatalog = ReadonlyArray<{ name: string; hash: string }>;

// `catalog` is overridable for tests only, so the upgrade path can be exercised with a synthetic later migration.
export function migrationDigest(catalog: MigrationCatalog = releasedMigrations): string { return createHash("sha256").update(catalog.map((item) => `${item.name}:${item.hash}`).join("\n")).digest("hex"); }

export function verifyMigrationFiles(migrationsFolder: string, catalog: MigrationCatalog = releasedMigrations): void {
  const names = readdirSync(migrationsFolder).filter((name) => {
    try { return readFileSync(path.join(/* turbopackIgnore: true */ migrationsFolder, name, "migration.sql")).length > 0; } catch { return false; }
  }).sort();
  if (names.join("\n") !== catalog.map((item) => item.name).join("\n")) throw new Error("The bundled migration set does not match the immutable release catalog.");
  for (const migration of catalog) {
    const actual = createHash("sha256").update(readFileSync(path.join(/* turbopackIgnore: true */ migrationsFolder, migration.name, "migration.sql"))).digest("hex");
    if (actual !== migration.hash) throw new Error(`Released migration ${migration.name} was modified.`);
  }
}
