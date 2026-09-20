import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.PALWORLD_MANAGER_DB ?? ".data-next/registry-v3.sqlite",
  },
  strict: true,
  verbose: true,
});
