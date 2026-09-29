export type ModVariant = "windows" | "linux";

export interface Ue4ssRuntimeStatus {
  variant: ModVariant;
  /** False while the variant's on-disk layout has not been confirmed on a real server. */
  layoutVerified: boolean;
  binariesPresent: boolean;
  installed: boolean;
  loader: boolean;
  memberLayout: boolean;
  guiConsole: "hidden" | "visible" | "unknown";
  modsDirectory: string;
  /** Present when PSM installed this UE4SS from the library. */
  managed: { artifactId: string; version: string; enabled: boolean; updateAvailable: boolean; recoveryPaused: boolean } | null;
  /** Whether UE4SS loads on the next start; null when PSM did not install it and cannot tell. */
  active: boolean | null;
  warnings: Array<"member-layout-missing" | "gui-console-visible" | "gui-console-unknown">;
}

export interface LuaModView {
  name: string;
  enabled: boolean;
  /** Enabled and UE4SS will load it; false while UE4SS is disabled or absent, null when unknown. */
  active: boolean | null;
  enabledBy: "mods-txt" | "enabled-txt" | null;
  hasScript: boolean;
  /** Installed from the manager's library (a psm-mod.json marker is present). */
  managed: boolean;
  artifactId: string | null;
  /** The library holds a different copy of this mod than the world. */
  updateAvailable: boolean;
}

export interface WorkshopModView {
  folder: string;
  packageName: string | null;
  displayName: string | null;
  version: string | null;
  serverCapable: boolean;
  active: boolean;
  error: string | null;
}

export interface WorkshopStatus {
  /** Official server-side mods run only on the Windows dedicated server. */
  platformSupported: boolean;
  settingsExists: boolean;
  globalEnable: boolean;
  activeMods: string[];
  mods: WorkshopModView[];
}

export interface WorldModsView {
  ue4ss: Ue4ssRuntimeStatus;
  /** The library build that matches this world's server platform. */
  library: { id: string; name: string; version: string; downloaded: boolean } | null;
  luaMods: LuaModView[];
  /** Library Lua mods not yet installed in this world. */
  availableLuaMods: Array<{ id: string; name: string }>;
  workshop: WorkshopStatus;
}

export interface LibraryLuaMod {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  addedAt: number;
  usedIn: Array<{ worldId: string; displayName: string }>;
}

export interface ModLibraryEntry {
  id: string;
  kind: "ue4ss";
  name: string;
  variant: ModVariant;
  version: string;
  project: string;
  projectUrl: string;
  license: string;
  sizeBytes: number;
  sha256: string;
  downloaded: boolean;
  downloading: boolean;
  /** Where the file comes from; shown in the consent dialog before anything is fetched. */
  url: string;
  detectedIn: Array<{ worldId: string; displayName: string }>;
}
