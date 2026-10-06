import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const releasedMigrations = [
  { name: "20260920061630_smiling_roxanne_simpson", hash: "cfe95bab7ab7c4de55a0aec94ec3cad4e283753b71397461ce4b0b1cfde74973" },
  { name: "20260920062556_calm_ultimo", hash: "a0386d3d746a412b197a1de09f8d4430d34a407c64d5564421911f941f6ba6bf" },
  { name: "20260920132257_red_aqueduct", hash: "90ceb03564e43dc5f8d66461a6a5ffc36c7e74c2e5161b6effcb47fb88dc7443" },
  { name: "20260921011320_dapper_bloodscream", hash: "b2bf31b8f78e025ed3eddeb896028d6e66e3162aae782f1eb9bb1fc496ae2884" },
  { name: "20260921012446_acoustic_loki", hash: "9ef05fd6f984b28c14e4d0c8a60622cae328c3d48a25e1aa2364b2083773ae1a" },
  { name: "20260922014643_freezing_victor_mancha", hash: "5406d2d4abf52e42ce735ae4e14c5a1a597834b44685621241665803e3d82fd7" },
  { name: "20260926210400_lean_sage", hash: "2dfc544e4d224279a5b65a68d5a7a3cc024eb743af7ce5764f07c2a3c2ad2e11" },
  { name: "20260929043011_drop_legacy_imports", hash: "939685d3970b05028e74fe41a065a55720ba7c3acbe2b61743a0384f8f4a2210" },
  { name: "20260929044619_mod_runtimes", hash: "2a39d0503b7b70348dd4226ba7bc01f04aeee5fd88240fc63e0f6ba224bf9c37" },
  { name: "20260929214411_mod_artifacts", hash: "3d89923e50e0aad27f55db085fed7aef38251819e515ea708f4e3cbefbdf0ee2" },
  { name: "20261005003801_native_windows_runtime", hash: "f584505da29987f81566aa95e087410207690b637e2a5a1ae42f0b1eb9ec6043" },
  { name: "20261006010603_drop_mods_table", hash: "a514458c5d880f801d1b14b2497873e98ef970256743f321e496efec20c7b337" },
] as const;

export function migrationDigest(): string { return createHash("sha256").update(releasedMigrations.map((item) => `${item.name}:${item.hash}`).join("\n")).digest("hex"); }

export function verifyMigrationFiles(migrationsFolder: string): void {
  const names = readdirSync(migrationsFolder).filter((name) => {
    try { return readFileSync(path.join(/* turbopackIgnore: true */ migrationsFolder, name, "migration.sql")).length > 0; } catch { return false; }
  }).sort();
  if (names.join("\n") !== releasedMigrations.map((item) => item.name).join("\n")) throw new Error("The bundled migration set does not match the immutable release catalog.");
  for (const migration of releasedMigrations) {
    const actual = createHash("sha256").update(readFileSync(path.join(/* turbopackIgnore: true */ migrationsFolder, migration.name, "migration.sql"))).digest("hex");
    if (actual !== migration.hash) throw new Error(`Released migration ${migration.name} was modified.`);
  }
}
