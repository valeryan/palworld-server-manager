import { z } from "zod";

export const retentionSettingsSchema = z.object({
  operationDays: z.coerce.number().int().min(7).max(3_650),
  operationCount: z.coerce.number().int().min(50).max(10_000),
  operationLogLines: z.coerce.number().int().min(100).max(20_000),
  activityDays: z.coerce.number().int().min(30).max(3_650),
  activityCountPerWorld: z.coerce.number().int().min(100).max(50_000),
  serverLogFilesPerWorld: z.coerce.number().int().min(5).max(500),
  configurationVersionsPerWorld: z.coerce.number().int().min(10).max(1_000),
}).strict();

export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

export const defaultRetentionSettings: RetentionSettings = {
  operationDays: 180,
  operationCount: 1_000,
  operationLogLines: 2_000,
  activityDays: 365,
  activityCountPerWorld: 5_000,
  serverLogFilesPerWorld: 30,
  configurationVersionsPerWorld: 100,
};
