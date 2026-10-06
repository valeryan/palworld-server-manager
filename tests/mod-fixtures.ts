import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import type { CatalogArtifact } from "@/server/mods/catalog";

// Shared by the UE4SS tests: fake releases that mirror the real archive layouts.
export const context = () => ({ signal: new AbortController().signal, update: async () => undefined, log: () => undefined });
export async function exists(target: string): Promise<boolean> { try { await stat(target); return true; } catch { return false; } }
export async function put(file: string, content = ""): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }
export async function world(baseDir: string, name: string, platform: "windows" | "linux") {
  const installDir = path.join(baseDir, name);
  await mkdir(path.join(installDir, "Pal", "Binaries", platform === "windows" ? "Win64" : "Linux"), { recursive: true });
  const { createWorld } = await import("@/server/services/worlds");
  return createWorld({ displayName: name, installDir, platform });
}

// Mirrors the real release layouts, including the bundled example mods that must be left out.
export function windowsArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile("dwmapi.dll", Buffer.from("loader"));
  zip.addFile("ue4ss/UE4SS.dll", Buffer.from("runtime"));
  zip.addFile("ue4ss/UE4SS-settings.ini", Buffer.from("[Debug]\nConsoleEnabled = 1\nGuiConsoleEnabled = 1\nGuiConsoleVisible = 1\n"));
  zip.addFile("ue4ss/MemberVariableLayout.ini", Buffer.from("offsets"));
  zip.addFile("ue4ss/Mods/mods.txt", Buffer.from("CheatManagerEnablerMod : 1\n"));
  zip.addFile("ue4ss/Mods/CheatManagerEnablerMod/Scripts/main.lua", Buffer.from("-- cheat"));
  zip.addFile("ue4ss/Mods/shared/Types.lua", Buffer.from("-- types"));
  return zip.toBuffer();
}
export function linuxArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile("libUE4SS.so", Buffer.from("preload"));
  zip.addFile("UE4SS-settings.ini", Buffer.from("GuiConsoleVisible = 1\n"));
  zip.addFile("MemberVariableLayout.ini", Buffer.from("offsets"));
  zip.addFile("UE4SS_Signatures/FName_ToString.lua", Buffer.from("-- sig"));
  zip.addFile("Mods/PalServerOptimizer/Scripts/main.lua", Buffer.from("-- experimental"));
  zip.addFile("Mods/shared/UEHelpers/UEHelpers.lua", Buffer.from("-- helpers"));
  return zip.toBuffer();
}

export async function stage(variant: "windows" | "linux", archive: Buffer): Promise<void> {
  const { MOD_CATALOG, artifactPath } = await import("@/server/mods/catalog");
  const catalog = MOD_CATALOG as CatalogArtifact[];
  const index = catalog.findIndex((entry) => entry.variant === variant);
  catalog[index] = { ...catalog[index]!, sizeBytes: archive.byteLength, sha256: createHash("sha256").update(archive).digest("hex") };
  await put(artifactPath(catalog[index]!), "");
  await writeFile(artifactPath(catalog[index]!), archive);
}

