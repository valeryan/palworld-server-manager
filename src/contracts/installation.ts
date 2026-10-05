export interface InstallationHealth {
  state: "missing" | "installing" | "failed" | "repair-needed" | "ready";
  reasons: string[]; lastJobId: string | null;
  canStart: boolean; canBackup: boolean; canInstall: boolean;
  prerequisite: { state: "installed" | "missing" | "unknown" | "detection-failed"; detail: string; repairAvailable: boolean };
}
