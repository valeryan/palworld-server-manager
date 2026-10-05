import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
  await expect(page.locator(".development-indicator")).toHaveCount(0);

  await page.getByRole("button", { name: "+ New world" }).click();
  await page.getByRole("button", { name: /Use existing server/ }).click();
  await page.getByLabel("Name").fill("Automated World");
  await page.getByLabel("Existing PalServer directory").fill(worldDirectory);
  await expect(page.getByLabel("Game port")).toHaveValue(/^\d+$/);
  await page.getByLabel("Game port").fill("39611");
  await page.getByLabel("Query port").fill("39612");
  await page.getByLabel("REST API port").fill("39613");
  await page.getByLabel("RCON port").fill("39614");
  await page.getByRole("button", { name: "Add this server" }).click();
  await expect(page.getByRole("heading", { name: "Automated World" })).toBeVisible();

  await page.getByRole("link", { name: "Manage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Automated World", level: 1 })).toBeVisible();
  for (const tab of ["Overview", "Players", "Deaths", "Console", "Settings", "Backups", "Schedule"]) {
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Properties", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Server Admin", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Server & Admin", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Multiplayer", exact: true }).click();
  const crossplaySelect = page.getByRole("group", { name: "Crossplay platforms", exact: true });
  const crossplayLayout = crossplaySelect.locator("xpath=ancestor::div[contains(@class,'structured-layout-item')][1]");
  await expect(crossplayLayout).toHaveClass(/span-12/);
  for (const platform of ["Steam", "Xbox", "PS5", "Mac"]) await expect(crossplaySelect.getByRole("button", { name: platform, exact: true })).toHaveAttribute("aria-pressed", "true");
  await crossplaySelect.getByRole("button", { name: "Xbox", exact: true }).click();
  await crossplaySelect.getByRole("button", { name: "Mac", exact: true }).click();
  await expect(crossplaySelect.getByRole("button", { name: "Xbox", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(async () => (await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`)).json()).toMatchObject({ configuration: { options: { CrossplayPlatforms: "(Steam,PS5)" } } });
  await page.getByRole("tab", { name: "Gameplay", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Time & Progression" })).toBeVisible();
  const daySpeedHelp = page.getByRole("button", { name: "Help for Day speed" });
  await expect(daySpeedHelp).toBeEnabled();
  await daySpeedHelp.hover();
  const daySpeedTooltip = page.getByRole("tooltip");
  await expect(daySpeedTooltip.locator("strong")).toHaveText("DayTimeSpeedRate");
  await expect(daySpeedTooltip).toContainText("Higher makes daytime pass faster and become shorter");
  await expect(page.locator(".setting-label > small")).toHaveCount(0);
  await page.getByRole("button", { name: "Casual PvE", exact: true }).click();
  await expect(page.getByText("Reviewing 4 staged changes")).toBeVisible();
  await expect(page.locator(".structured-field.changed")).toHaveCount(4);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("button", { name: "Raw INI & history" }).click();
  const editor = page.locator(".settings-editor");
  await expect(editor).toContainText("E2E World");
  await editor.fill('[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="Automated E2E",Difficulty=None,ExpRate=2.000000,ServerReplicatePawnCullDistance=NaN)\n');
  await page.getByRole("button", { name: "Save raw settings" }).click();
  await expect(page.getByText("Configuration saved; restart to apply changes")).toBeVisible();
  await expect(page.getByText("saved", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Guided configuration", exact: true }).click();
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Community Listing" })).toBeVisible();
  await expect(page.locator(".service-block")).toHaveCount(2);
  const descriptionInput = page.getByLabel("Description", { exact: true });
  const descriptionLayout = descriptionInput.locator("xpath=ancestor::div[contains(@class,'structured-layout-item')][1]");
  const [descriptionBox, descriptionInputBox] = await Promise.all([descriptionLayout.boundingBox(), descriptionInput.boundingBox()]);
  expect(descriptionBox && descriptionInputBox && descriptionInputBox.width > descriptionBox.width * 0.8).toBe(true);
  const communityLayout = page.getByRole("button", { name: "Community server", exact: true }).locator("xpath=ancestor::div[contains(@class,'structured-layout-item')][1]");
  const publicIpLayout = page.getByLabel("Public IP (for tunnels)", { exact: true }).locator("xpath=ancestor::div[contains(@class,'structured-layout-item')][1]");
  const publicPortLayout = page.getByLabel("Public port (advertised)", { exact: true }).locator("xpath=ancestor::div[contains(@class,'structured-layout-item')][1]");
  const [communityBox, publicIpBox, publicPortBox] = await Promise.all([communityLayout.boundingBox(), publicIpLayout.boundingBox(), publicPortLayout.boundingBox()]);
  expect(communityBox && publicIpBox && publicPortBox && communityBox.y < publicIpBox.y && Math.abs(publicIpBox.y - publicPortBox.y) < 2).toBe(true);
  await page.getByRole("button", { name: "Help for Game port" }).hover();
  const gamePortTooltip = page.getByRole("tooltip");
  await expect(gamePortTooltip.locator("strong")).toHaveText("PSM setting");
  await expect(gamePortTooltip).toContainText("local UDP listener");
  await expect(page.getByRole("heading", { name: "Performance & Synchronization" })).toBeVisible();
  const synchronizationDistance = page.getByRole("button", { name: "Help for Pal synchronization distance (cm)" }).locator("xpath=ancestor::div[contains(@class,'structured-field')][1]");
  await expect(synchronizationDistance.getByText("NaN", { exact: true })).toBeVisible();
  await expect(synchronizationDistance).toContainText("Expected a valid number");
  await expect(synchronizationDistance.getByRole("button", { name: "Replace with shipped default" })).toBeVisible();
  const publicPort = page.getByLabel("Public port (advertised)", { exact: true });
  await publicPort.fill("49611");
  const publicPortCard = publicPort.locator("xpath=ancestor::label[1]");
  await expect(publicPortCard).toHaveClass(/changed/);
  await expect(page.getByRole("button", { name: "Review changes (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved 1 setting")).toBeVisible();
  const worldId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}/configuration/admin`);
    return ((await response.json()) as { configuration: { options: Record<string, string> } }).configuration.options.ServerReplicatePawnCullDistance;
  }).toBe("NaN");
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await page.getByRole("button", { name: "Help for Pal synchronization distance (cm)" }).locator("xpath=ancestor::div[contains(@class,'structured-field')][1]").getByRole("button", { name: "Replace with shipped default" }).click();
  await expect(page.getByRole("button", { name: "Review changes (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}/configuration/admin`);
    return ((await response.json()) as { configuration: { options: Record<string, string> } }).configuration.options.ServerReplicatePawnCullDistance;
  }).toBe("15000.000000");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByPlaceholder("Search settings or keys…").fill("DenyTechnologyList");
  const deniedTechnologies = page.getByLabel("Denied technologies", { exact: true });
  await deniedTechnologies.fill('(TechnologyA,"Technology B")');
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}/configuration/admin`);
    return ((await response.json()) as { configuration: { options: Record<string, string> } }).configuration.options.DenyTechnologyList;
  }).toBe('(TechnologyA,"Technology B")');

  await page.getByRole("button", { name: "Mods", exact: true }).click();
  await expect(page.getByText("UE4SS is not installed")).toBeVisible();
  await expect(page.getByText("No Workshop mods are installed.")).toBeVisible();

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

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Access & Security" })).toBeVisible();
  await page.getByLabel("Administrator password", { exact: true }).fill("temporary-admin-password");
  await page.getByLabel("Server password", { exact: true }).fill("temporary-server-password");
  await page.getByRole("button", { name: "REST API", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`);
    const payload = await response.json() as { configuration: { options: Record<string, string> } };
    return `${payload.configuration.options.AdminPassword}:${payload.configuration.options.ServerPassword}`;
  }).toBe('"temporary-admin-password":"temporary-server-password"');
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await page.getByRole("button", { name: "Crash recovery", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`);
    const payload = await response.json() as { configuration: { options: Record<string, string> } };
    return `${payload.configuration.options.AdminPassword}:${payload.configuration.options.ServerPassword}`;
  }).toBe('"temporary-admin-password":"temporary-server-password"');
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await page.getByLabel("Administrator password", { exact: true }).fill("");
  await page.getByLabel("Server password", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`);
    const payload = await response.json() as { configuration: { options: Record<string, string> } };
    return `${payload.configuration.options.AdminPassword}:${payload.configuration.options.ServerPassword}`;
  }).toBe('"":""');
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
  await page.getByRole("button", { name: "Guided configuration", exact: true }).click();
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await expect(page.locator(".port-summary")).toContainText("49611");
  await page.getByLabel("Game port", { exact: true }).fill("39621");
  await page.getByRole("button", { name: "Community server", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const [worldResponse, adminResponse] = await Promise.all([page.request.get(`/api/worlds/${worldId}`), page.request.get(`/api/worlds/${worldId}/configuration/admin`)]);
    const world = ((await worldResponse.json()) as { world: { gamePort: number; communityServer: boolean } }).world;
    const advertised = ((await adminResponse.json()) as { configuration: { advertisedPort: { mode: string; effectivePort: number } } }).configuration.advertisedPort;
    return `${world.gamePort}:${world.communityServer}:${advertised.mode}:${advertised.effectivePort}`;
  }).toBe("39621:true:override:49611");
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await page.getByLabel("Game port", { exact: true }).fill("39622");
  await page.getByLabel("Public port (advertised)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}/configuration/admin`);
    const payload = await response.json() as { admin: { gamePort: number; communityServer: boolean }; configuration: { advertisedPort: { mode: string; effectivePort: number } } };
    return `${payload.admin.gamePort}:${payload.admin.communityServer}:${payload.configuration.advertisedPort.mode}:${payload.configuration.advertisedPort.effectivePort}`;
  }).toBe("39622:true:inherit:39622");
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installation & Launch" })).toBeVisible();
  await expect(page.getByLabel("Install directory", { exact: true })).toHaveValue(worldDirectory);
  await expect(page.getByLabel("Platform", { exact: true })).toHaveValue("linux");
  const versionsBeforePsmSave = ((await (await page.request.get(`/api/worlds/${worldId}/configuration/versions`)).json()) as { versions: unknown[] }).versions.length;
  await page.getByLabel("Display name", { exact: true }).fill("Automated World Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Automated World Renamed", level: 1 })).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${new URL(page.url()).pathname.split("/").at(-1)}/configuration/admin`);
    const advertised = ((await response.json()) as { configuration: { advertisedPort: { mode: string; effectivePort: number } } }).configuration.advertisedPort;
    return `${advertised.mode}:${advertised.effectivePort}`;
  }).toBe("inherit:39622");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}`);
    return ((await response.json()) as { world: { communityServer: boolean } }).world.communityServer;
  }).toBe(true);
  await expect.poll(async () => ((await (await page.request.get(`/api/worlds/${worldId}/configuration/versions`)).json()) as { versions: unknown[] }).versions.length).toBe(versionsBeforePsmSave + 1);
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  const serverName = page.getByLabel("Server name", { exact: true });
  const displayName = page.getByLabel("Display name", { exact: true });
  await displayName.fill("");
  await serverName.fill("Inherited Server Name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Inherited Server Name", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Display name", { exact: true })).toHaveAttribute("placeholder", "Inherited Server Name");
  await page.getByLabel("Server name", { exact: true }).fill("Followed Server Name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Followed Server Name", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await waitForLatestJob(page, "start");
  await page.reload();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Server Admin", exact: true }).click();
  await page.getByLabel("Administrator password", { exact: true }).fill("staged-while-running");
  await page.getByRole("button", { name: "Save changes" }).click();
  const pendingRestart = page.getByRole("button", { name: "Restart", exact: true });
  await expect(pendingRestart).toHaveClass(/restart-pending/);
  await expect(pendingRestart).toHaveAttribute("title", "Settings changes are pending and will be applied during this restart.");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}/configuration/admin`);
    const payload = await response.json() as { configuration: { pendingApply: boolean; options: Record<string, string>; appliedOptions: Record<string, string> } };
    return `${payload.configuration.pendingApply}:${payload.configuration.options.AdminPassword}:${payload.configuration.appliedOptions.AdminPassword}`;
  }).toBe('true:"staged-while-running":""');
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await waitForLatestJob(page, "restart");
  await page.reload();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get(`/api/worlds/${worldId}/configuration/admin`);
    const payload = await response.json() as { configuration: { pendingApply: boolean; appliedOptions: Record<string, string> } };
    return `${payload.configuration.pendingApply}:${payload.configuration.appliedOptions.AdminPassword}`;
  }).toBe('false:"staged-while-running"');
  await page.route(`**/api/worlds/${worldId}/logs`, (route) => route.fulfill({ json: {
    ok: true, logs: { files: ["fixture.log"], selected: "fixture.log", content: "Server ready\nPlayer fixture joined\n" },
  } }));
  await page.getByRole("button", { name: "Console", exact: true }).click();
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  const consoleOutput = page.locator(".console-panel .console-output");
  await expect(consoleOutput).toContainText("Server ready");
  await page.getByLabel("Search this log").fill("PLAYER");
  await expect(consoleOutput).toHaveText("Player fixture joined");
  await page.getByLabel("Search this log").fill("not-present");
  await expect(consoleOutput).toHaveText("No lines match this search.");
  await page.getByLabel("Search this log").fill("");
  await page.getByRole("button", { name: "Pause live updates" }).click();
  await expect(page.getByRole("button", { name: "Resume live updates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download full log" })).toHaveAttribute("href", `/api/worlds/${worldId}/logs/download?file=fixture.log`);
  const announcementInput = page.getByPlaceholder("Announcement to all online players");
  await expect(announcementInput).toBeDisabled();
  await page.route(`**/api/worlds/${worldId}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ json: { ...body, world: { ...body.world, restApiEnabled: true } } });
  });
  await expect(announcementInput).toBeEnabled();
  let announcement: unknown;
  await page.route(`**/api/worlds/${worldId}/admin`, (route) => {
    announcement = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true } });
  });
  await announcementInput.fill("Fixture announcement");
  await page.getByRole("button", { name: "Send announcement" }).click();
  await expect(announcementInput).toHaveValue("");
  expect(announcement).toEqual({ action: "announce", message: "Fixture announcement" });
  await page.unroute(`**/api/worlds/${worldId}/admin`);
  await page.route(`**/api/worlds/${worldId}/admin`, (route) => route.fulfill({ status: 503, json: { error: "Fixture announcement rejected" } }));
  await announcementInput.fill("Rejected announcement");
  await page.getByRole("button", { name: "Send announcement" }).click();
  await expect(page.getByText("Fixture announcement rejected", { exact: true })).toBeVisible();
  await page.unroute(`**/api/worlds/${worldId}/admin`);
  await page.unroute(`**/api/worlds/${worldId}`);
  await page.unroute(`**/api/worlds/${worldId}/logs`);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await waitForLatestJob(page, "stop");
  await page.reload();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Mods", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mods library", level: 1 })).toBeVisible();
  await expect(page.getByText("UE4SS for Linux 1.0.4-palworld-linux")).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  for (const setting of ["Close to system tray", "Launch at login", "Manager web port", "History and log retention", "Authenticated remote administration", "Language", "Manager data"]) {
    await expect(page.getByRole("button", { name: `Help for ${setting}` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Help for Completed operations" }).hover();
  const retentionTooltip = page.getByRole("tooltip");
  await expect(retentionTooltip.locator("strong")).toHaveText("Completed operations");
  await expect(retentionTooltip).toContainText("Maximum number of completed operation records");
  await expect(page.locator(".launch-option-grid small, .custom-launch-flags small, .retention-footer small, .language-control > small")).toHaveCount(0);
});

test("removes an incomplete world from the overview without deleting its files", async ({ page }) => {
  await authenticate(page);
  const installDir = path.join(process.cwd(), ".e2e-runtime", "removal-world");
  const created = await page.request.post("/api/worlds", { data: { displayName: "Incomplete removal fixture", installDir, platform: "linux", gamePort: 39771, queryPort: 39772, restApiPort: 39773, rconPort: 39774 } });
  expect(created.ok()).toBe(true);
  const { world } = await created.json() as { world: { id: string } };
  await mkdir(installDir, { recursive: true });
  const savedFile = path.join(installDir, "saved-fixture.txt");
  await writeFile(savedFile, "preserve this save");
  await page.goto(`/worlds/${world.id}`);
  const remove = page.getByRole("button", { name: "Remove from manager", exact: true });
  await expect(remove).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await remove.click();
  expect((await page.request.get(`/api/worlds/${world.id}`)).ok()).toBe(true);
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("Server files and saves will be kept"); await dialog.accept(); });
  await remove.click();
  await expect(page).toHaveURL("/");
  expect((await page.request.get(`/api/worlds/${world.id}`)).status()).toBe(404);
  expect(await readFile(savedFile, "utf8")).toBe("preserve this save");
});
