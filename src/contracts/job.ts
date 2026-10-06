import { z } from "zod";

export const JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const jobStateSchema = z.enum(JOB_STATES);
export type JobState = z.infer<typeof jobStateSchema>;

export interface JobView {
  id: string;
  worldId: string | null;
  kind: string;
  state: JobState;
  progress: number;
  message: string;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** Operation kinds the application starts. Tests may use other kinds; the column stays a string. */
export const JOB_KINDS = ["start", "stop", "restart", "autostart", "crash-recovery", "steamcmd-bootstrap", "steamcmd-reinstall", "repair-prerequisites", "install", "update", "update-restart", "update-all", "check-update", "backup", "restore", "scheduled-backup", "scheduled-restart", "scheduled-stop", "scheduled-update", "scheduled-system-message", "scheduled-onscreen-notice", "scheduled-custom-http", "scheduled-idle-stop", "mod-download", "mod-install", "mod-remove", "mod-repair"] as const;
export type JobKind = typeof JOB_KINDS[number];

/** Operations that install or update the game files of a world. */
export const SERVER_INSTALL_JOB_KINDS: ReadonlySet<string> = new Set<JobKind>(["install", "update", "update-restart", "scheduled-update"]);
/** Operations whose external worker (SteamCMD, the prerequisite installer) can outlive the manager. */
export const EXTERNAL_WORKER_JOB_KINDS: ReadonlySet<string> = new Set<JobKind>(["steamcmd-bootstrap", "steamcmd-reinstall", "install", "update", "update-restart", "scheduled-update", "repair-prerequisites"]);
/** Operations that belong to the manager itself rather than to one world. */
export const APP_JOB_KINDS: ReadonlySet<string> = new Set<JobKind>(["steamcmd-bootstrap", "steamcmd-reinstall", "update-all", "mod-download"]);

/** Which operations a listing covers: one world's, the manager's own (no world), or every operation. */
export type JobScope = { worldId?: string; app?: boolean };
export type JobListResponse = { jobs: JobView[]; summary: { total: number; active: number; failed: number } };

export function isJobActive(job: Pick<JobView, "state">): boolean { return job.state === "queued" || job.state === "running"; }

export interface ManagerEvent {
  id: string;
  type: "job" | "world";
  worldId?: string;
  timestamp: number;
  data: unknown;
}
