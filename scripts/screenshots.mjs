import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Captures the README screenshots from the development web app in the default theme.
//   npm run dev:web            (in another terminal, with at least one world registered)
//   node scripts/screenshots.mjs stopped    → dashboard, settings menu, delete dialog (world stopped)
//   node scripts/screenshots.mjs running    → every tab and page (world running)
// Images land in docs/screenshots/. The development badge, version line, and Next.js dev overlay are hidden.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.PSM_SCREENSHOT_URL ?? "http://127.0.0.1:4319";
const out = path.join(root, "docs", "screenshots");
const mode = process.argv[2] ?? "running";
const hidden = ".development-indicator, .sidebar-foot small, nextjs-portal";

const { worlds } = await (await fetch(`${base}/api/worlds`)).json();
const world = worlds[0];
if (!world) throw new Error("Register a world in the development app first.");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
await context.addInitScript((selector) => { document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = `${selector}{visibility:hidden !important}`; document.head.append(style); }); }, hidden);
const page = await context.newPage();

async function settle(ms = 1200) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); }
async function shot(name) { await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log("saved", name); }
async function tab(label) { await page.locator("button", { hasText: new RegExp(`^${label}$`) }).first().click(); await settle(); }
async function openWorld() { await page.goto(`${base}/worlds/${world.id}`); await settle(1500); }

if (mode === "stopped") {
  await page.goto(`${base}/`); await settle(1500); await shot("dashboard");
  await openWorld(); await tab("Settings");
  await page.getByRole("button", { name: "Settings options" }).click(); await page.waitForTimeout(500); await shot("world-settings-menu");
  await page.getByText("Remove and delete server files…").click(); await page.waitForTimeout(600); await shot("delete-world");
} else {
  await page.goto(`${base}/`); await settle(1500); await shot("dashboard");
  await openWorld(); await shot("world-overview");
  await tab("Players"); await shot("world-players");
  await tab("Console"); await settle(2000); await shot("world-console");
  await tab("Settings"); await settle(1500); await shot("world-settings");
  await tab("Mods"); await settle(1500); await shot("world-mods");
  await tab("Backups"); await shot("world-backups");
  await tab("Schedule"); await shot("world-schedule");
  for (const route of ["operations", "settings", "mods"]) { await page.goto(`${base}/${route}`); await settle(1500); await shot(route === "mods" ? "mods-library" : route === "settings" ? "app-settings" : route); }
}
await browser.close();
