import "server-only";
import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";
import { hostPlatform } from "@/server/host";
export interface ProcessIdentity { pid: number; parentPid: number; started: string; executable: string; commandLine: string }
const execute = promisify(execFile);
export async function processSnapshot(): Promise<ProcessIdentity[]> {
  if (hostPlatform() === "win32") {
    const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -and $_.ExecutablePath } | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;started=$_.CreationDate.ToUniversalTime().Ticks.ToString();executable=$_.ExecutablePath;commandLine=''} }) | ConvertTo-Json -Compress";
    const { stdout } = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
    const rows = JSON.parse(stdout || "[]");
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, executable: row.executable ?? "", commandLine: row.commandLine ?? "" }));
  }
  const rows = await Promise.all((await readdir("/proc")).filter((entry) => /^\d+$/.test(entry)).map(async (entry): Promise<ProcessIdentity | null> => {
    try {
      const root = `/proc/${entry}`; const value = await readFile(`${root}/stat`, "utf8"); const fields = value.slice(value.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z") return null;
      const executable = await readlink(`${root}/exe`);
      return { pid: Number(entry), parentPid: Number(fields[1]), started: fields[19]!, executable, commandLine: "" };
    } catch { return null; }
  }));
  return rows.filter((row): row is ProcessIdentity => row !== null);
}
export function sameProcess(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.started === b.started && a.executable === b.executable && Boolean(a.executable);
}
export function ownedTree(roots: ProcessIdentity[], snapshot: ProcessIdentity[]): ProcessIdentity[] {
  const found = snapshot.filter((entry) => roots.some((root) => sameProcess(root, entry)));
  const ids = new Set(found.map((entry) => entry.pid));
  let changed = true;
  while (changed) { changed = false; for (const entry of snapshot) if (!ids.has(entry.pid) && ids.has(entry.parentPid) && entry.executable) { found.push(entry); ids.add(entry.pid); changed = true; } }
  return found;
}
