import "server-only";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { WorldView } from "@/contracts/world";
import { ConflictError } from "@/server/errors";
import { exists, isDirectory } from "@/server/fs";
import { paths } from "@/server/paths";
import { fileMatches, movePath } from "@/server/services/archive";

/** Marker file PSM writes into every mod folder it installed. */
export const MANAGED_MARKER = "psm-mod.json";

export function sha256Hex(data: string | Uint8Array): string { return createHash("sha256").update(data).digest("hex"); }

/** A trimmed string, or null for anything else. Used for loosely typed JSON read from disk. */
export function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

/** The parsed marker in `folder`, or null when it is absent or unreadable. `accept` narrows the shape. */
export async function readMarker<T>(folder: string, accept: (value: unknown) => value is T): Promise<T | null> {
  try { const value: unknown = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ folder, MANAGED_MARKER), "utf8")); return accept(value) ? value : null; }
  catch { return null; }
}

/**
 * Before PSM writes `folder`: when something PSM did not install already sits there, require the
 * caller's `replace` consent and move it to the world's mod trash instead of overwriting it.
 */
export async function moveAsideUnmanaged(world: Pick<WorldView, "id">, folder: string, name: string, managed: boolean, replace: boolean | undefined, origin = "by PSM"): Promise<void> {
  if (!await isDirectory(folder) || managed) return;
  if (!replace) throw new ConflictError(`${name} already exists in this world but was not installed ${origin}. Use "Replace with library version".`);
  await movePath(folder, path.join(/* turbopackIgnore: true */ paths.modTrash(world.id), `${name}-${Date.now()}`));
}

export interface ExpectedFile { size: number; data: () => Buffer }

/**
 * Compares the files PSM installed with the library copy they came from. A file whose expected
 * bytes are unknown (no library copy) is only checked for presence.
 */
export async function classifyInstalled(targets: Array<{ file: string; target: string }>, expected: ReadonlyMap<string, ExpectedFile>, source: string): Promise<{ missing: string[]; changed: string[] }> {
  const missing: string[] = []; const changed: string[] = [];
  for (const { file, target } of targets) {
    const wanted = expected.get(file);
    const matches = wanted ? await fileMatches(target, source, wanted) : (await exists(target)) || null;
    if (matches === null) missing.push(file); else if (!matches) changed.push(file);
  }
  return { missing, changed };
}

/** Reads a library file and checks its digest, failing with the caller's messages. */
export async function readVerified(file: string, sha256: string, messages: { missing: string; tampered: string }): Promise<Buffer> {
  const data = await readFile(file).catch(() => { throw new Error(messages.missing); });
  if (sha256Hex(data) !== sha256) throw new Error(messages.tampered);
  return data;
}
