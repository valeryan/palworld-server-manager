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
  warnings: Array<"member-layout-missing" | "gui-console-visible" | "gui-console-unknown">;
}

export interface LuaModView {
  name: string;
  enabled: boolean;
  enabledBy: "mods-txt" | "enabled-txt" | null;
  hasScript: boolean;
  /** Installed from the manager's library (a psm-mod.json marker is present). */
  managed: boolean;
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
  luaMods: LuaModView[];
  workshop: WorkshopStatus;
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
  detectedIn: Array<{ worldId: string; displayName: string }>;
}
