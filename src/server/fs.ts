import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function exists(target: string): Promise<boolean> { return (await stat(target).catch(() => null)) !== null; }
export async function isFile(target: string): Promise<boolean> { return (await stat(target).catch(() => null))?.isFile() ?? false; }
export async function isDirectory(target: string): Promise<boolean> { return (await stat(target).catch(() => null))?.isDirectory() ?? false; }

/** The file's text, or null when it is absent, unreadable, or larger than `maxBytes`. */
export async function readOptional(target: string, maxBytes?: number): Promise<string | null> {
  try {
    if (maxBytes !== undefined) { const info = await stat(target); if (!info.isFile() || info.size > maxBytes) return null; }
    return await readFile(target, "utf8");
  } catch { return null; }
}

/** Writes through a sibling temporary file and renames it into place, so readers never see a partial file. */
export async function writeFileAtomic(target: string, data: string | Uint8Array, options: { mode?: number } = {}): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, data, options.mode === undefined ? {} : { mode: options.mode });
  await rename(temporary, target);
}
