import { z } from "zod";

export const jobStateSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
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

export interface ManagerEvent {
  id: string;
  type: "job" | "world";
  worldId?: string;
  timestamp: number;
  data: unknown;
}
