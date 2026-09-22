import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultRetentionSettings } from "@/contracts/retention";

describe("persistent history retention", () => {
  let directory: string | undefined;
  afterAll(async () => {
    const { sqliteClient } = await import("@/server/db"); sqliteClient().close(); globalThis.__psmDatabase = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("prunes every bounded store while preserving active operations", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "psm-retention-test-"));
    process.env.PALWORLD_MANAGER_DATA_DIR = directory;
    process.env.PALWORLD_MANAGER_DB = path.join(directory, "registry-v3.sqlite");
    const [{ sqliteClient }, { applyRetentionPolicy }] = await Promise.all([import("@/server/db"), import("@/server/services/retention")]);
    const client = sqliteClient(); const now = Date.now();
    client.prepare("INSERT INTO worlds (id,display_name,install_dir,game_port,query_port,rest_api_port,rcon_port,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("world", "World", path.join(directory, "server"), 8211, 8212, 8213, 25575, now, now);
    const insertJob = client.prepare("INSERT INTO jobs (id,world_id,kind,state,progress,message,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?)");
    for (let index = 0; index < 55; index += 1) insertJob.run(`job-${index}`, "world", "test", "succeeded", 100, "Complete", now + index, now + index);
    insertJob.run("active", "world", "test", "running", 50, "Working", now - 99_999, null);
    const insertLog = client.prepare("INSERT INTO job_logs (job_id,message,created_at) VALUES (?,?,?)");
    for (let index = 0; index < 105; index += 1) insertLog.run("job-54", `line ${index}`, now + index);
    for (const table of ["events", "sessions", "deaths"] as const) {
      for (let index = 0; index < 105; index += 1) {
        if (table === "events") client.prepare("INSERT INTO events (world_id,kind,message,created_at) VALUES (?,?,?,?)").run("world", "test", `event ${index}`, now + index);
        else if (table === "sessions") client.prepare("INSERT INTO sessions (world_id,user_id,player_name,event,created_at) VALUES (?,?,?,?,?)").run("world", `user-${index}`, `Player ${index}`, "join", now + index);
        else client.prepare("INSERT INTO deaths (world_id,victim,created_at) VALUES (?,?,?)").run("world", `Player ${index}`, now + index);
      }
    }
    for (let index = 0; index < 12; index += 1) client.prepare("INSERT INTO config_versions (id,world_id,file_name,content,created_at) VALUES (?,?,?,?,?)").run(`config-${index}`, "world", "PalWorldSettings.ini", "content", now + index);
    const logDirectory = path.join(directory, "logs", "world"); await mkdir(logDirectory, { recursive: true });
    for (let index = 0; index < 7; index += 1) await writeFile(path.join(logDirectory, `server-${String(index).padStart(2, "0")}.log`), "log");
    const report = await applyRetentionPolicy({ ...defaultRetentionSettings, operationCount: 50, operationLogLines: 100, activityCountPerWorld: 100, serverLogFilesPerWorld: 5, configurationVersionsPerWorld: 10 }, now);
    expect(report).toEqual({ operations: 5, operationLogs: 5, events: 5, sessions: 5, deaths: 5, serverLogs: 2, configurationVersions: 2 });
    expect((client.prepare("SELECT count(*) count FROM jobs WHERE state='running'").get() as { count: number }).count).toBe(1);
  });
});
