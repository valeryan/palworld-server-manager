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
export const JOB_KINDS = ["start", "stop", "restart", "autostart", "crash-recovery", "steamcmd-bootstrap", "repair-prerequisites", "install", "update", "check-update", "backup", "restore", "scheduled-backup", "scheduled-restart", "scheduled-stop", "scheduled-update", "scheduled-system-message", "scheduled-onscreen-notice", "scheduled-custom-http", "scheduled-idle-stop", "mod-download", "mod-install", "mod-remove", "mod-repair"] as const;
export type JobKind = typeof JOB_KINDS[number];

/** Operations that install or update the game files of a world. */
export const SERVER_INSTALL_JOB_KINDS: ReadonlySet<string> = new Set<JobKind>(["install", "update", "scheduled-update"]);
/** Operations whose external worker (SteamCMD, the prerequisite installer) can outlive the manager. */
export const EXTERNAL_WORKER_JOB_KINDS: ReadonlySet<string> = new Set<JobKind>(["steamcmd-bootstrap", "install", "update", "scheduled-update", "repair-prerequisites"]);

export function isJobActive(job: Pick<JobView, "state">): boolean { return job.state === "queued" || job.state === "running"; }

export interface ManagerEvent {
  id: string;
  type: "job" | "world";
  worldId?: string;
  timestamp: number;
  data: unknown;
}
