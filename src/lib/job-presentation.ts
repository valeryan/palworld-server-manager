import type { JobState, JobView } from "@/contracts/job";

const jobLabels: Record<string, string> = {
  start: "Start server",
  stop: "Stop server",
  restart: "Restart server",
  autostart: "Automatic server start",
  "crash-recovery": "Crash recovery",
  install: "Install server",
  update: "Update server",
  "check-update": "Check for updates",
  backup: "Create backup",
  restore: "Restore backup",
  "scheduled-backup": "Scheduled backup",
  "scheduled-restart": "Scheduled restart",
  "scheduled-stop": "Scheduled stop",
  "scheduled-update": "Scheduled update",
  "scheduled-system-message": "Scheduled server message",
  "scheduled-onscreen-notice": "Scheduled on-screen notice",
  "scheduled-custom-http": "Scheduled HTTP request",
  "scheduled-idle-stop": "Scheduled stop when empty",
  "mod-download": "Download to Mods library",
  "mod-install": "Install UE4SS",
  "mod-remove": "Remove UE4SS",
  "mod-repair": "Repair mods",
};

const startingMessages: Record<string, string> = {
  start: "Starting server",
  stop: "Stopping server",
  restart: "Restarting server",
  autostart: "Starting server automatically",
  "crash-recovery": "Recovering server after a crash",
  install: "Installing server",
  update: "Updating server",
  "check-update": "Checking for updates",
  backup: "Creating backup",
  restore: "Restoring backup",
  "scheduled-backup": "Creating scheduled backup",
  "scheduled-restart": "Preparing scheduled restart",
  "scheduled-stop": "Preparing scheduled stop",
  "scheduled-update": "Preparing scheduled update",
  "scheduled-system-message": "Sending scheduled server message",
  "scheduled-onscreen-notice": "Sending scheduled on-screen notice",
  "scheduled-custom-http": "Sending scheduled HTTP request",
  "scheduled-idle-stop": "Stopping empty server",
  "mod-download": "Downloading to the Mods library",
  "mod-install": "Installing UE4SS",
  "mod-remove": "Removing UE4SS",
  "mod-repair": "Repairing mods",
};

const successMessages: Record<string, string> = {
  start: "Server started successfully",
  stop: "Server stopped successfully",
  restart: "Server restarted successfully",
  autostart: "Server started automatically",
  "crash-recovery": "Server recovered successfully",
  install: "Server installation completed",
  update: "Server update completed",
  "check-update": "Update check completed",
  backup: "Backup created and verified",
  restore: "Backup restored successfully",
  "scheduled-backup": "Scheduled backup completed",
  "scheduled-restart": "Scheduled restart completed",
  "scheduled-stop": "Scheduled stop completed",
  "scheduled-update": "Scheduled update completed",
  "scheduled-system-message": "Scheduled server message sent",
  "scheduled-onscreen-notice": "Scheduled on-screen notice sent",
  "scheduled-custom-http": "Scheduled HTTP request completed",
  "scheduled-idle-stop": "Empty server stopped successfully",
  "mod-download": "Download verified and added to the Mods library",
  "mod-install": "UE4SS installed",
  "mod-remove": "UE4SS removed",
  "mod-repair": "Mods repaired",
};

const stateLabels: Record<JobState, string> = {
  queued: "Waiting",
  running: "In progress",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Canceled",
};

export function humanizeIdentifier(value: string): string {
  return value.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function jobKindLabel(kind: string): string { return jobLabels[kind] ?? humanizeIdentifier(kind); }
export function jobStartingMessage(kind: string): string { return startingMessages[kind] ?? `Running ${jobKindLabel(kind).toLowerCase()}`; }
export function jobSuccessMessage(kind: string): string { return successMessages[kind] ?? `${jobKindLabel(kind)} completed`; }
export function jobStateLabel(state: JobState): string { return stateLabels[state]; }

export function jobDisplayMessage(job: Pick<JobView, "kind" | "state" | "message">): string {
  if (job.message === "Queued") return `${jobKindLabel(job.kind)} is waiting to begin`;
  if (job.message === "Starting") return jobStartingMessage(job.kind);
  if (job.message === "Complete") return jobSuccessMessage(job.kind);
  if (job.message === "Failed") return `${jobKindLabel(job.kind)} failed`;
  if (job.message === "Cancelled" || job.message === "Cancelling") return job.message === "Cancelled" ? `${jobKindLabel(job.kind)} was canceled` : `Canceling ${jobKindLabel(job.kind).toLowerCase()}`;
  return job.message;
}
