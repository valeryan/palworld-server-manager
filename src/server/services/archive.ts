import "server-only";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import type AdmZip from "adm-zip";
import type { JobContext } from "./jobs";

// Apply portable extraction rules before any write, including Windows aliases on Linux.
export function safeArchivePath(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /[\x00-\x1f:]/.test(normalized)) return false;
  const parts = normalized.replace(/\/$/, "").split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== ".." && !/[ .]$/.test(part) && !/[<>"|?*]/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function safeEntries(zip: AdmZip): boolean {
  const seen = new Set<string>(); const files = new Set<string>();
  for (const entry of zip.getEntries()) {
    if (!safeArchivePath(entry.entryName) || ((entry.attr >>> 16) & 0o170000) === 0o120000) return false;
    const key = entry.entryName.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); if (!entry.isDirectory) files.add(key);
  }
  for (const key of seen) { const parts = key.split("/"); while (parts.length > 1) { parts.pop(); if (files.has(parts.join("/"))) return false; } }
  return true;
}

// The path of an entry below an archive folder. The check runs again after the folder is removed:
// "Mod/../../x" is safe as a whole entry but escapes the folder once "Mod/" is gone.
export function relativeEntry(entryName: string, root: string): string {
  const relative = path.posix.normalize(entryName.replaceAll("\\", "/").slice(root.length));
  if (!safeArchivePath(relative) || relative === "." || relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) throw new Error("The archive contains unsafe paths.");
  return relative;
}

// Keeps a written path inside the folder it belongs to, whatever the relative path says.
export function insideFolder(folder: string, relative: string): string {
  if (!safeArchivePath(relative)) throw new Error("Refusing to write outside the extraction root or use an unsafe archive path.");
  const target = path.resolve(/* turbopackIgnore: true */ folder, ...relative.split("/"));
  if (!target.startsWith(`${path.resolve(/* turbopackIgnore: true */ folder)}${path.sep}`)) throw new Error(`Refusing to write outside ${folder}: ${relative}`);
  return target;
}

// Whether a file PSM installed still holds the library's bytes. Results are kept per file until
// its size or modification time changes, so refreshing the Mods tab does not re-read every file.
declare global { var __psmFileMatches: Map<string, { size: number; mtimeMs: number; source: string; equal: boolean }> | undefined }
export async function fileMatches(target: string, source: string, expected: { size: number; data: () => Buffer }): Promise<boolean | null> {
  const info = await stat(target).catch(() => null); if (!info) return null;
  if (info.size !== expected.size) return false;
  const cache = (globalThis.__psmFileMatches ??= new Map()); const cached = cache.get(target);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.source === source) return cached.equal;
  const equal = expected.data().equals(await readFile(target));
  cache.set(target, { size: info.size, mtimeMs: info.mtimeMs, source, equal });
  return equal;
}

export interface VerifiedDownload { url: string; sha256: string; sizeBytes: number; destination: string; staging: string }

// Streams a pinned artifact into a staging file, stopping at the expected size, and only
// moves it into place once size and SHA-256 both match. Nothing partial is ever left behind.
export async function downloadVerified(download: VerifiedDownload, context: JobContext): Promise<void> {
  await mkdir(download.staging, { recursive: true });
  const temporary = path.join(/* turbopackIgnore: true */ download.staging, `${randomUUID()}.part`);
  const hash = createHash("sha256");
  const file = await open(temporary, "wx");
  let received = 0;
  try {
    const response = await fetch(download.url, { signal: context.signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}.`);
    context.log(`Downloading ${download.url}`);
    let reported = -1;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (received > download.sizeBytes) throw new Error(`Download is larger than the pinned ${download.sizeBytes} bytes; refusing it.`);
      hash.update(chunk); await file.write(chunk);
      const percent = Math.floor((received / download.sizeBytes) * 90);
      if (percent >= reported + 5) { reported = percent; await context.update(percent, `Downloaded ${(received / 1_048_576).toFixed(1)} of ${(download.sizeBytes / 1_048_576).toFixed(1)} MiB`); }
    }
    await file.close();
    if (received !== download.sizeBytes) throw new Error(`Download ended at ${received} of ${download.sizeBytes} bytes.`);
    const digest = hash.digest("hex");
    if (digest !== download.sha256) throw new Error(`Checksum mismatch: expected ${download.sha256}, received ${digest}. The file was discarded.`);
    context.log(`SHA-256 verified: ${digest}`);
    await mkdir(path.dirname(download.destination), { recursive: true });
    await rename(temporary, download.destination);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

// Moves a file or directory, copying and then deleting when source and destination are on
// different filesystems (world folders and manager data often are).
export async function movePath(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  try { await rename(source, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await rm(source, { recursive: true, force: true });
  }
}
