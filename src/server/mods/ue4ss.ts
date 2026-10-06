import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ModVariant, Ue4ssRuntimeStatus } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";
import { exists } from "@/server/fs";

export interface Ue4ssLayout {
  variant: ModVariant;
  layoutVerified: boolean;
  binaries: string;
  loader: string;
  runtimeMarkers: string[];
  settingsCandidates: string[];
  memberLayoutCandidates: string[];
  modsCandidates: string[];
  /** Mods-directory entries that belong to UE4SS, Palworld, or the manager's own relays, not to the user. UE4SS creates UE4SSStatus on start. */
  reserved: ReadonlySet<string>;
}

async function firstExisting(candidates: string[]): Promise<string | null> { for (const candidate of candidates) if (await exists(candidate)) return candidate; return null; }

// The layout follows the world's server build, not the host: a Windows build run
// under Wine still uses Win64 and the dwmapi.dll injector.
export function ue4ssLayout(world: Pick<WorldView, "installDir" | "platform">): Ue4ssLayout {
  if (world.platform === "windows") {
    const win64 = path.join(/* turbopackIgnore: true */ world.installDir, "Pal", "Binaries", "Win64");
    const runtime = path.join(/* turbopackIgnore: true */ win64, "ue4ss");
    return {
      variant: "windows", layoutVerified: true, binaries: win64, loader: path.join(/* turbopackIgnore: true */ win64, "dwmapi.dll"),
      // The runtime DLL, not the ue4ss folder: UE4SS's own log keeps the folder after removal.
      runtimeMarkers: [path.join(/* turbopackIgnore: true */ runtime, "UE4SS.dll"), path.join(/* turbopackIgnore: true */ win64, "UE4SS.dll")],
      settingsCandidates: [path.join(/* turbopackIgnore: true */ runtime, "UE4SS-settings.ini"), path.join(/* turbopackIgnore: true */ win64, "UE4SS-settings.ini")],
      memberLayoutCandidates: [path.join(/* turbopackIgnore: true */ runtime, "MemberVariableLayout.ini"), path.join(/* turbopackIgnore: true */ win64, "MemberVariableLayout.ini")],
      // UE4SS 3.x keeps mods under ue4ss/Mods; 2.x used Win64/Mods.
      modsCandidates: [path.join(/* turbopackIgnore: true */ runtime, "Mods"), path.join(/* turbopackIgnore: true */ win64, "Mods")],
      reserved: new Set(["shared", "BPModLoaderMod", "UE4SSStatus", "PSMDeathRelay", "PSMBroadcast"]),
    };
  }
  // Native Linux port: files sit next to PalServer.sh (confirmed on Palworld v1.0.5 with
  // the pinned build). Its Mods/ is also Palworld's official mod folder.
  const root = world.installDir;
  return {
    variant: "linux", layoutVerified: true, binaries: path.join(/* turbopackIgnore: true */ root, "Pal", "Binaries", "Linux"), loader: path.join(/* turbopackIgnore: true */ root, "libUE4SS.so"),
    runtimeMarkers: [],
    settingsCandidates: [path.join(/* turbopackIgnore: true */ root, "UE4SS-settings.ini")],
    memberLayoutCandidates: [path.join(/* turbopackIgnore: true */ root, "MemberVariableLayout.ini")],
    modsCandidates: [path.join(/* turbopackIgnore: true */ root, "Mods")],
    reserved: new Set(["shared", "BPModLoaderMod", "UE4SSStatus", "PSMDeathRelay", "PSMBroadcast", "Workshop", "NativeMods"]),
  };
}

export async function resolveModsDirectory(layout: Ue4ssLayout): Promise<string> {
  return await firstExisting(layout.modsCandidates) ?? layout.modsCandidates[0]!;
}

export function readGuiConsole(content: string): Ue4ssRuntimeStatus["guiConsole"] {
  const value = content.match(/^\s*GuiConsoleVisible\s*=\s*(\d+)/im)?.[1];
  return value === undefined ? "unknown" : value === "0" ? "hidden" : "visible";
}

// Read-only: reports what is on disk and never changes it.
export async function detectUe4ss(world: Pick<WorldView, "installDir" | "platform">): Promise<Ue4ssRuntimeStatus> {
  const layout = ue4ssLayout(world);
  const [binariesPresent, loader, runtime, settingsPath, memberLayoutPath, modsDirectory] = await Promise.all([
    exists(layout.binaries), exists(layout.loader), firstExisting(layout.runtimeMarkers),
    firstExisting(layout.settingsCandidates), firstExisting(layout.memberLayoutCandidates), resolveModsDirectory(layout),
  ]);
  const installed = loader || runtime !== null;
  const guiConsole = settingsPath ? readGuiConsole(await readFile(settingsPath, "utf8").catch(() => "")) : "unknown";
  const warnings: Ue4ssRuntimeStatus["warnings"] = [];
  if (installed && !memberLayoutPath) warnings.push("member-layout-missing");
  if (installed && guiConsole === "visible") warnings.push("gui-console-visible");
  if (installed && guiConsole === "unknown") warnings.push("gui-console-unknown");
  return { variant: layout.variant, layoutVerified: layout.layoutVerified, binariesPresent, installed, loader, memberLayout: memberLayoutPath !== null, guiConsole, modsDirectory, managed: null, active: installed ? null : false, warnings };
}
