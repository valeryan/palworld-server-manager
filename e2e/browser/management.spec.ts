import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const worldDirectory = path.join(process.cwd(), ".e2e-runtime", "world");

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "psm_admin", value: "e2e-admin", domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

async function waitForLatestJob(page: Page, kind: string) {
  await expect.poll(async () => {
    const response = await page.request.get("/api/jobs?limit=20");
    const payload = await response.json() as { jobs: Array<{ kind: string; state: string; error?: string | null }> };
    const job = payload.jobs.find((item) => item.kind === kind);
    return job ? `${job.state}:${job.error ?? ""}` : "missing";
  }, { timeout: 30_000 }).toBe("succeeded:");
}

test("adopts and manages an isolated world through critical browser workflows", async ({ page }) => {
  await authenticate(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Palworld servers" })).toBeVisible();

  await page.getByRole("button", { name: "+ New world" }).click();
  await page.getByRole("button", { name: /Use existing server/ }).click();
  await page.getByLabel("Name").fill("Automated World");
  await page.getByLabel("Existing PalServer directory").fill(worldDirectory);
  await page.getByLabel("Game port").fill("39611");
  await page.getByLabel("Query port").fill("39612");
  await page.getByLabel("REST API port").fill("39613");
  await page.getByLabel("RCON port").fill("39614");
  await page.getByRole("button", { name: "Add this server" }).click();
  await expect(page.getByRole("heading", { name: "Automated World" })).toBeVisible();

  await page.getByRole("link", { name: "Manage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Automated World", level: 1 })).toBeVisible();
  for (const tab of ["Overview", "Players", "Deaths", "Console", "Server config", "Backups", "Schedule", "Properties"]) {
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Server config", exact: true }).click();
  await page.getByRole("button", { name: "Time & Rates", exact: true }).click();
  const daySpeedHelp = page.getByRole("button", { name: "Help for Day speed" });
  await expect(daySpeedHelp).toBeEnabled();
  await daySpeedHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText("Higher makes daytime pass faster and become shorter");
  await page.getByRole("button", { name: "Raw INI & history" }).click();
  const editor = page.locator(".settings-editor");
  await expect(editor).toContainText("E2E World");
  await editor.fill('[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Automated E2E",Difficulty=None,ExpRate=2.000000)\n');
  await page.getByRole("button", { name: "Save raw settings" }).click();
  await expect(page.getByText("Configuration saved; restart to apply changes")).toBeVisible();
  await expect(page.getByText("saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guided configuration", exact: true }).click();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByLabel("Public port (advertised)", { exact: true }).fill("49611");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved 1 setting; restart to apply changes")).toBeVisible();

  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByLabel("Keep newest backups").fill("3");
  await page.getByRole("button", { name: "Save backup settings" }).click();
  await expect(page.getByText("Backup settings saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back up now" }).click();
  await waitForLatestJob(page, "backup");
  await page.reload();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await waitForLatestJob(page, "restore");

  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.locator('select[name="action"]').selectOption("backup");
  await page.locator('select[name="mode"]').selectOption("minutes");
  await page.locator('input[name="intervalMinutes"]').fill("30");
  await page.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByText("Every 30 minutes")).toBeVisible();
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("button", { name: "Enable" })).toBeVisible();

  await page.getByRole("button", { name: "Server config", exact: true }).click();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  const managedAdmin = page.locator(".admin-managed-settings");
  await managedAdmin.locator('input[type="password"]').nth(0).fill("temporary-admin-password");
  await managedAdmin.locator('input[type="password"]').nth(1).fill("temporary-server-password");
  await page.getByText("REST API", { exact: true }).locator("..").getByRole("button").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`);
    const payload = await response.json() as { admin: { adminPasswordSet: boolean; serverPasswordSet: boolean } };
    return `${payload.admin.adminPasswordSet}:${payload.admin.serverPasswordSet}`;
  }).toBe("true:true");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByLabel("Clear stored admin password").check();
  await page.getByLabel("Clear stored server password").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`);
    const payload = await response.json() as { admin: { adminPasswordSet: boolean; serverPasswordSet: boolean } };
    return `${payload.admin.adminPasswordSet}:${payload.admin.serverPasswordSet}`;
  }).toBe("false:false");
  await page.getByRole("button", { name: "Raw INI & history", exact: true }).click();
  const reconciledEditor = page.locator(".settings-editor");
  const beforeRawReconcile = await reconciledEditor.inputValue();
  const oldRestPort = beforeRawReconcile.match(/RESTAPIPort=(\d+)/)?.[1];
  expect(oldRestPort).toBeTruthy();
  await reconciledEditor.fill(beforeRawReconcile.replace(`RESTAPIPort=${oldRestPort}`, "RESTAPIPort=39615"));
  await page.getByRole("button", { name: "Save raw settings" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}`);
    return ((await response.json()) as { world: { restApiPort: number } }).world.restApiPort;
  }).toBe(39615);
  await page.getByRole("button", { name: "Restore", exact: true }).nth(1).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}`);
    return ((await response.json()) as { world: { restApiPort: number } }).world.restApiPort;
  }).toBe(Number(oldRestPort));
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await expect(page.getByLabel("Install directory")).toHaveValue(worldDirectory);
  await expect(page.locator('select[name="platform"]')).toHaveValue("linux");
  await page.getByLabel("Display name in PSM").fill("Automated World Renamed");
  await page.getByRole("button", { name: "Save properties" }).click();
  await expect(page.getByRole("heading", { name: "Automated World Renamed", level: 1 })).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/options`);
    return ((await response.json()) as { configuration: { options: Record<string, string> } }).configuration.options.PublicPort;
  }).toBe("49611");

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await waitForLatestJob(page, "start");
  await page.reload();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await waitForLatestJob(page, "restart");
  await page.reload();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await waitForLatestJob(page, "stop");
  await page.reload();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
});
