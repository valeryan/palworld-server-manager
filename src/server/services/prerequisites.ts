import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostPlatform } from "@/server/host";
import { paths } from "@/server/paths";
import type { WorldView } from "@/contracts/world";
import type { InstallationHealth } from "@/contracts/installation";
import { downloadToFile } from "./download";
import type { JobContext } from "./jobs";
import { assertWorldStopped } from "./worlds";
const execute = promisify(execFile);
const cache = new Map<string, { at: number; result: InstallationHealth["prerequisite"] }>();
const ps = (script: string, timeout = 15_000) => execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
export function bundledPrerequisite(world: Pick<WorldView, "installDir">): string { return path.join(/* turbopackIgnore: true */ world.installDir, "Engine", "Extras", "Redist", "en-us", "UEPrereqSetup_x64.exe"); }
export async function inspectPrerequisites(world: Pick<WorldView, "installDir" | "platform">, force = false): Promise<InstallationHealth["prerequisite"]> {
  if (hostPlatform() !== "win32" || world.platform !== "windows") return { state: "installed", detail: "Native Windows prerequisites do not apply to this execution environment.", repairAvailable: false };
  const saved = cache.get(world.installDir); if (!force && saved && Date.now() - saved.at < 60_000) return saved.result;
  let result: InstallationHealth["prerequisite"];
  try {
    const { stdout } = await ps("$ErrorActionPreference='Stop'; $found=@('HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64') | Where-Object { Test-Path $_ } | ForEach-Object { Get-ItemProperty $_ }; [bool]($found | Where-Object { $_.Installed -eq 1 }) | ConvertTo-Json");
    result = JSON.parse(stdout) ? { state: "installed", detail: "Visual C++ x64 runtime registered. Game-specific dependency validation still occurs at server launch; bundled Unreal repair is available if needed.", repairAvailable: true } : { state: "missing", detail: "The Microsoft Visual C++ x64 runtime is not registered. Repair prerequisites before starting.", repairAvailable: true };
  } catch (error) { result = { state: "detection-failed", detail: `Could not inspect Windows runtime prerequisites: ${error instanceof Error ? error.message : String(error)}`, repairAvailable: true }; }
  cache.set(world.installDir, { at: Date.now(), result }); return result;
}
export async function repairPrerequisites(world: WorldView, context: JobContext): Promise<void> {
  if (hostPlatform() !== "win32" || world.platform !== "windows") throw new Error("Prerequisite repair is only available for a native Windows world.");
  assertWorldStopped(world, "Stop the world before repairing prerequisites.");
  const staging = path.join(/* turbopackIgnore: true */ paths.data(), "prerequisites", randomUUID()); await mkdir(staging, { recursive: true });
  try {
    let installer = bundledPrerequisite(world); const bundled = existsSync(installer);
    if (!bundled) {
      installer = path.join(/* turbopackIgnore: true */ staging, "vc_redist.x64.exe");
      await context.update(10, "Downloading Microsoft Visual C++ x64 runtime");
      await downloadToFile("https://aka.ms/vc14/vc_redist.x64.exe", installer, { signal: context.signal, maxBytes: 100 * 1024 * 1024, label: "Prerequisite", timeoutMs: 120_000 });
    }
    context.signal.throwIfAborted();
    await context.update(35, "Verifying installer publisher");
    const verification = `$ErrorActionPreference='Stop'; $file=${quote(installer)}; $signature=Get-AuthenticodeSignature -LiteralPath $file; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=(Microsoft Corporation|Epic Games,? Inc\.?)') { throw 'Installer signature or publisher is not trusted.' }; `;
    await ps(verification);
    context.log(`Verified ${bundled ? "bundled Unreal" : "Microsoft"} installer: ${installer}`);
    await context.update(50, "Waiting for Windows installer and elevation approval");
    // Only this signed installer is elevated. Cancellation cannot safely kill an elevated MSI transaction.
    context.nonCancellable?.();
    const args = "/install /passive /norestart";
    const { stdout } = await ps(verification + `try { $p=Start-Process -FilePath $file -ArgumentList ${quote(args)} -Verb RunAs -PassThru -Wait; $p.ExitCode | ConvertTo-Json } catch { if ($_.Exception.NativeErrorCode -eq 1223) { '1223' } else { throw } }`, 30 * 60 * 1000);
    const code = Number(stdout.trim());
    if (code === 1223) throw new Error("Windows elevation was cancelled. Prerequisites were not installed.");
    if (![0, 3010, 1641].includes(code)) throw new Error(`Prerequisite installer failed with exit code ${code}.`);
    const after = await inspectPrerequisites(world, true);
    if (code === 3010 || code === 1641) { context.log("Windows reports a reboot is required. Restart Windows before launching the server."); await context.update(100, "Prerequisite installer completed; Windows restart required", { preserveOnSuccess: true }); return; }
    if (after.state !== "installed") throw new Error(`Installer completed but verification did not pass: ${after.detail}`);
    await context.update(100, "Prerequisites repaired and rechecked");
  } finally { await rm(staging, { recursive: true, force: true }); }
}
