import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("packaged Electron boots its bundled server and exposes desktop IPC", async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "psm-packaged-e2e-"));
  await writeFile(path.join(userData, "desktop-preferences.json"), JSON.stringify({ closeToTray: false, managerPort: 4338 }));
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.PSM_PORT = "4338"; delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath: path.join(process.cwd(), "release", "linux-unpacked", "palworld-server-manager-next"),
    args: [`--user-data-dir=${userData}`],
    env,
    timeout: 120_000,
  });
  try {
    const page = await application.firstWindow({ timeout: 120_000 });
    await expect(page).toHaveTitle("Palworld Server Manager");
    await expect(page.getByRole("heading", { name: "Palworld servers" })).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { psmDesktop?: unknown }).psmDesktop))).toBe(true);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Active port: 4338")).toBeVisible();
    const closeToTray = await page.evaluate(() => (globalThis as typeof globalThis & { psmDesktop: { getCloseToTray(): Promise<boolean> } }).psmDesktop.getCloseToTray());
    expect(closeToTray).toBe(false);
    await page.getByRole("link", { name: "Worlds" }).click();
    await page.getByRole("button", { name: "+ New world" }).click();
    await expect(page.getByRole("heading", { name: "Add a world" })).toBeVisible();
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
