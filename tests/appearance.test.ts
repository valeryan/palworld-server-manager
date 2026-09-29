import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareTestDatabase } from "./prepare-database";

describe("persistent appearance settings", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "psm-appearance-test-"));
    process.env.PALWORLD_MANAGER_DATA_DIR = directory;
    process.env.PALWORLD_MANAGER_DB = path.join(directory, "registry-v3.sqlite");
    await prepareTestDatabase(directory, process.env.PALWORLD_MANAGER_DB);
  });

  afterAll(async () => {
    const { sqliteClient } = await import("@/server/db");
    sqliteClient().close();
    globalThis.__psmDatabase = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it("uses Pal until a valid theme is stored in app settings", async () => {
    const { getTheme, saveTheme } = await import("@/server/services/appearance");
    await expect(getTheme()).resolves.toBe("pal");
    await expect(saveTheme("ancient")).resolves.toBe("ancient");
    await expect(getTheme()).resolves.toBe("ancient");
    await expect(saveTheme("missing-theme")).rejects.toThrow("invalid");
    await expect(getTheme()).resolves.toBe("ancient");
  });
});
