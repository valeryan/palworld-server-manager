import "server-only";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, open, rename, rm } from "node:fs/promises";
import type AdmZip from "adm-zip";
import type { JobContext } from "./jobs";

// Rejects any entry that would land outside the extraction root.
export function safeEntries(zip: AdmZip): boolean {
  return zip.getEntries().every((entry) => {
    const normalized = path.posix.normalize(entry.entryName.replaceAll("\\", "/"));
    return normalized !== ".." && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized);
  });
}

export interface VerifiedDownload { url: string; sha256: string; sizeBytes: number; destination: string; staging: string }

// Streams a pinned artifact into a staging file, stopping at the expected size, and only
// moves it into place once size and SHA-256 both match. Nothing partial is ever left behind.
export async function downloadVerified(download: VerifiedDownload, context: JobContext): Promise<void> {
  await mkdir(download.staging, { recursive: true });
  const temporary = path.join(download.staging, `${randomUUID()}.part`);
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
