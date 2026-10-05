import { _electron as electron, expect, test } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const alpha1Migrations = ["20260920061630_smiling_roxanne_simpson", "20260920062556_calm_ultimo", "20260920132257_red_aqueduct", "20260921011320_dapper_bloodscream", "20260921012446_acoustic_loki", "20260922014643_freezing_victor_mancha"];
async function createAlpha1Database(userData: string) {
  const client = new DatabaseSync(path.join(userData, "registry-v3.sqlite")); client.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric);");
  for (const name of alpha1Migrations) { const sql = await readFile(path.join(process.cwd(), "drizzle", name, "migration.sql"), "utf8"); for (const statement of sql.split("--> statement-breakpoint")) client.exec(statement); const hash = (await import("node:crypto")).createHash("sha256").update(sql).digest("hex"); client.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(hash, Date.now()); }
  client.exec(await readFile(path.join(process.cwd(), "tests", "fixtures", "upgrade-alpha.1.sql"), "utf8")); client.close();
}

test("packaged Electron boots its bundled server and exposes desktop IPC", async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "psm-packaged-e2e-"));
  // Run outside the checkout so missing packaged dependencies cannot resolve from
  // the repository's node_modules and falsely pass this release gate.
  const packageRoot = path.join(userData, "application");
  await cp(path.join(process.cwd(), "release", "linux-unpacked"), packageRoot, { recursive: true });
  const executable = path.join(packageRoot, "palworld-server-manager-next");
  await writeFile(path.join(userData, "desktop-preferences.json"), await readFile(path.join(process.cwd(), "tests", "fixtures", "upgrade-alpha.1-desktop-preferences.json")));
  await createAlpha1Database(userData);
  const home = path.join(userData, "home"); const autostart = path.join(home, ".config", "autostart", "com.palworld.servermanager.next.desktop"); await mkdir(path.dirname(autostart), { recursive: true }); await writeFile(autostart, '[Desktop Entry]\nType=Application\nExec="/obsolete/Palworld-Server-Manager-1.0.0-alpha.1-x86_64.AppImage" --hidden --custom-kept=value\nX-PSM-Test=preserved\n');
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.PSM_PORT = "4338"; env.HOME = home; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH;
  const application = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env,
    timeout: 120_000,
  });
  try {
    const upgrade = await application.firstWindow({ timeout: 120_000 });
    await expect(upgrade.getByRole("heading", { name: "Upgrade existing installation to 1.0.0-alpha.2?" })).toBeVisible();
    await upgrade.getByRole("button", { name: "Upgrade" }).click();
    await expect(upgrade.getByRole("heading", { name: "Upgrade complete" })).toBeVisible({ timeout: 90_000 });
    await expect(upgrade.getByText("Version 1.0.0-alpha.2 is ready. Continue to open Palworld Server Manager.")).toBeVisible();
    expect(application.windows().some((candidate) => candidate.url().startsWith("http://127.0.0.1:4338"))).toBe(false);
    await upgrade.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => application.windows().map((candidate) => candidate.url()), { timeout: 120_000 }).toContain("http://127.0.0.1:4338/");
    const page = application.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:4338"))!;
    await expect(page).toHaveTitle("Palworld Server Manager");
    await expect(page.getByRole("heading", { name: "Palworld servers" })).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { psmDesktop?: unknown }).psmDesktop))).toBe(true);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Active port: 4338")).toBeVisible();
    const updatedAutostart = await readFile(autostart, "utf8"); expect(updatedAutostart).toContain(executable); expect(updatedAutostart).toContain(" --hidden --custom-kept=value\nX-PSM-Test=preserved\n");
    const preferences = JSON.parse(await readFile(path.join(userData, "desktop-preferences.json"), "utf8")); expect(preferences.lastSuccessfulAppVersion).toBe("1.0.0-alpha.2");
    const upgraded = new DatabaseSync(path.join(userData, "registry-v3.sqlite"), { readOnly: true }); expect((upgraded.prepare("SELECT count(*) count FROM worlds WHERE id='fixture-world'").get() as { count: number }).count).toBe(1); expect(() => upgraded.prepare("SELECT * FROM world_settings").all()).not.toThrow(); upgraded.close();
    const closeToTray = await page.evaluate(() => (globalThis as typeof globalThis & { psmDesktop: { getCloseToTray(): Promise<boolean> } }).psmDesktop.getCloseToTray());
    expect(closeToTray).toBe(false);
    await page.getByRole("link", { name: "Worlds" }).click();
    await page.getByRole("button", { name: "+ New world" }).click();
    await expect(page.getByRole("heading", { name: "Add a world" })).toBeVisible();
  } finally {
    await application.close();
    await expect.poll(async () => { try { const response = await fetch("http://127.0.0.1:4338", { method: "HEAD", signal: AbortSignal.timeout(250) }); await response.body?.cancel(); return true; } catch { return false; } }).toBe(false);
    await rm(userData, { recursive: true, force: true });
  }
});
