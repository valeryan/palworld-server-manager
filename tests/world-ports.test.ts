import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareTestDatabase } from "./prepare-database";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "psm-ports-test-"));
  process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "data");
  process.env.PALWORLD_MANAGER_DB = path.join(directory, "data", "registry-v3.sqlite");
  await prepareTestDatabase(process.env.PALWORLD_MANAGER_DATA_DIR, process.env.PALWORLD_MANAGER_DB);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
beforeEach(async () => {
  delete process.env.PALWORLD_MANAGER_WORLD_PORT_OFFSET;
  const { sqliteClient } = await import("@/server/db");
  sqliteClient().exec("DELETE FROM world_settings; DELETE FROM worlds;");
});

describe("world port allocation", () => {
  it("suggests the Palworld defaults for the first world", async () => {
    const { suggestWorldPorts } = await import("@/server/services/worlds");
    expect(await suggestWorldPorts()).toEqual({ gamePort: 8211, queryPort: 27015, restApiPort: 8212, rconPort: 25575 });
  });

  it("shifts first-world defaults by the configured development offset", async () => {
    process.env.PALWORLD_MANAGER_WORLD_PORT_OFFSET = "1000";
    const { suggestWorldPorts } = await import("@/server/services/worlds");
    expect(await suggestWorldPorts()).toEqual({ gamePort: 9211, queryPort: 28015, restApiPort: 9212, rconPort: 26575 });
  });

  it("continues from the highest port of each service and skips ports used by another service", async () => {
    const { createWorld, suggestWorldPorts } = await import("@/server/services/worlds");
    await createWorld({ displayName: "One", installDir: path.join(directory, "one"), gamePort: 8211, queryPort: 8212, restApiPort: 8213, rconPort: 25575 });
    await createWorld({ displayName: "Two", installDir: path.join(directory, "two"), gamePort: 8221, queryPort: 8222, restApiPort: 8223, rconPort: 25576 });
    expect(await suggestWorldPorts()).toEqual({ gamePort: 8224, queryPort: 8225, restApiPort: 8226, rconPort: 25577 });
  });

  it("allocates omitted ports on creation and increments for the next world", async () => {
    process.env.PALWORLD_MANAGER_WORLD_PORT_OFFSET = "1000";
    const { createWorld } = await import("@/server/services/worlds");
    const first = await createWorld({ displayName: "First", installDir: path.join(directory, "first") });
    const second = await createWorld({ displayName: "Second", installDir: path.join(directory, "second"), rconPort: 30000 });
    expect([first.gamePort, first.queryPort, first.restApiPort, first.rconPort]).toEqual([9211, 28015, 9212, 26575]);
    expect([second.gamePort, second.queryPort, second.restApiPort, second.rconPort]).toEqual([9213, 28016, 9214, 30000]);
  });

  it("rejects an offset that pushes a default port out of range", async () => {
    process.env.PALWORLD_MANAGER_WORLD_PORT_OFFSET = "60000";
    const { suggestWorldPorts } = await import("@/server/services/worlds");
    await expect(suggestWorldPorts()).rejects.toThrow("PALWORLD_MANAGER_WORLD_PORT_OFFSET");
  });
});
