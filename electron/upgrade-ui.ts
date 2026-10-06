import { app, BrowserWindow } from "electron";
import { quitState } from "./environment";
import type { UpgradeStage } from "../src/server/db/upgrade";

// The small window shown while a version transition prepares local data. The pages answer through
// psm-upgrade:// navigations; closing the window counts as declining.

let upgradeWindow: BrowserWindow | null = null; let upgradeCloseBlocked = false;
export function upgradeWindowOpen(): boolean { return upgradeWindow !== null && !upgradeWindow.isDestroyed(); }
export function focusUpgradeWindow(): void { if (upgradeWindowOpen()) { upgradeWindow!.show(); upgradeWindow!.focus(); } }
export function destroyUpgradeWindow(): void { if (upgradeWindow && !upgradeWindow.isDestroyed()) upgradeWindow.destroy(); upgradeWindow = null; }

const upgradeStyles = `body{margin:0;background:#07101e;color:#eaf8ff;font:15px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:430px;max-width:calc(100vw - 64px)}h1{font-size:24px;margin:0 0 10px}p{color:#8da9bc;line-height:1.55}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:26px}button{border:1px solid #365777;border-radius:8px;padding:10px 16px;background:#162842;color:#eaf8ff;font:inherit}button.primary{background:#31c4fe;color:#06121b;border-color:#31c4fe;font-weight:800}.bar{height:7px;background:#162842;border-radius:10px;overflow:hidden;margin-top:24px}.bar i{display:block;height:100%;background:#31c4fe;transition:width .2s}.version{font:12px ui-monospace,monospace;color:#31c4fe}`;
const upgradePage = (body: string) => `data:text/html,${encodeURIComponent(`<meta charset="utf-8"><title>Palworld Server Manager upgrade</title><style>${upgradeStyles}</style><main class="card">${body}</main>`)}`;

function awaitUpgradeChoice(activeWindow: BrowserWindow, acceptUrl: string, onChoice?: (value: boolean) => void): { choice: Promise<boolean>; finish: (value: boolean) => void } {
  let settled = false; let resolveChoice!: (value: boolean) => void;
  const choice = new Promise<boolean>((resolve) => { resolveChoice = resolve; });
  const finish = (value: boolean) => { if (settled) return; settled = true; onChoice?.(value); activeWindow.webContents.removeListener("will-navigate", navigate); activeWindow.removeListener("closed", closed); resolveChoice(value); };
  const navigate = (event: Electron.Event, url: string) => { if (!url.startsWith("psm-upgrade://")) return; event.preventDefault(); finish(url === acceptUrl); };
  const closed = () => finish(false);
  activeWindow.webContents.on("will-navigate", navigate);
  activeWindow.once("closed", closed);
  return { choice, finish };
}

export async function confirmVersionTransition(previous: string | null, current: string, downgrade: boolean): Promise<boolean> {
  const heading = downgrade ? `Downgrade to ${current}?` : previous ? `Upgrade to ${current}?` : `Upgrade existing installation to ${current}?`;
  const detail = downgrade ? `This installation last started successfully with ${previous}. Continue only if you intentionally selected an older application. Database compatibility will be checked before startup.` : `The manager will safely prepare local data and update an existing launch-at-login entry before starting ${current}.`;
  upgradeWindow = new BrowserWindow({ width: 540, height: 360, resizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true, backgroundColor: "#07101e", title: "Palworld Server Manager upgrade", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  upgradeWindow.on("close", (event) => { if (upgradeCloseBlocked && !quitState.quitting) event.preventDefault(); });
  await upgradeWindow.loadURL(upgradePage(`<h1>${heading}</h1><p>${detail}</p><p class="version">${previous ?? "existing installation"} → ${current}</p><div class="actions"><button onclick="location.href='psm-upgrade://quit'">Quit</button><button class="primary" onclick="location.href='psm-upgrade://confirm'">${downgrade ? "Continue downgrade" : "Upgrade"}</button></div>`));
  return awaitUpgradeChoice(upgradeWindow, "psm-upgrade://confirm").choice;
}

export async function showUpgradeProgress(stage: UpgradeStage | "starting"): Promise<void> {
  if (!upgradeWindowOpen()) return;
  upgradeCloseBlocked = true;
  const stages: Record<typeof stage, [string, number]> = { preparing: ["Preparing upgrade…", 12], "backing-up": ["Backing up manager data…", 28], "updating-autostart": ["Updating launch-at-login…", 44], migrating: ["Migrating database…", 62], verifying: ["Verifying manager data…", 78], starting: [`Starting version ${app.getVersion()}…`, 90] };
  const [message, percent] = stages[stage]; upgradeWindow!.setClosable(false);
  await upgradeWindow!.loadURL(upgradePage(`<h1>${message}</h1><p>Please keep this application open while local data is prepared.</p><div class="bar"><i style="width:${percent}%"></i></div><p class="version">Version ${app.getVersion()}</p>`));
}

export async function showUpgradeCompletion(): Promise<boolean> {
  if (!upgradeWindowOpen()) return false;
  const activeWindow = upgradeWindow!;
  upgradeCloseBlocked = true;
  const { choice, finish } = awaitUpgradeChoice(activeWindow, "psm-upgrade://continue", (value) => { if (value) upgradeCloseBlocked = false; });
  try { await activeWindow.loadURL(upgradePage(`<h1>Upgrade complete</h1><p>Version ${app.getVersion()} is ready. Continue to open Palworld Server Manager.</p><div class="bar"><i style="width:100%"></i></div><p class="version">Version ${app.getVersion()}</p><div class="actions"><button class="primary" onclick="location.href='psm-upgrade://continue'">Continue</button></div>`)); }
  catch { finish(false); }
  return await choice;
}
