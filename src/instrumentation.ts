export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const [{ default: path }, { markDatabasePrepared, runDatabasePreflight }, { migrationDigest }, { paths }] = await Promise.all([
      import("node:path"), import("@/server/db/upgrade"), import("@/server/db/migration-catalog"), import("@/server/paths"),
    ]);
    if (process.env.PSM_DATABASE_PREFLIGHTED === migrationDigest()) markDatabasePrepared(paths.database());
    else await runDatabasePreflight({ databasePath: paths.database(), dataDirectory: paths.data(), migrationsFolder: path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle") });
    const { startRuntime } = await import("@/server/services/runtime");
    await startRuntime();
  }
}
