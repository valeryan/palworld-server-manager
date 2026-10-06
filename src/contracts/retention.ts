import { z } from "zod";

// Inclusive bounds for each retention setting; the schema and the settings form both derive from this.
export const retentionLimits = {
  operationDays: [7, 3_650],
  operationCount: [50, 10_000],
  operationLogLines: [100, 20_000],
  activityDays: [30, 3_650],
  activityCountPerWorld: [100, 50_000],
  serverLogFilesPerWorld: [5, 500],
  configurationVersionsPerWorld: [10, 1_000],
} as const satisfies Record<string, readonly [number, number]>;

export type RetentionSettingKey = keyof typeof retentionLimits;
export const retentionSettingKeys = Object.keys(retentionLimits) as RetentionSettingKey[];

const bounded = ([min, max]: readonly [number, number]) => z.coerce.number().int().min(min).max(max);
export const retentionSettingsSchema = z.object({
  operationDays: bounded(retentionLimits.operationDays),
  operationCount: bounded(retentionLimits.operationCount),
  operationLogLines: bounded(retentionLimits.operationLogLines),
  activityDays: bounded(retentionLimits.activityDays),
  activityCountPerWorld: bounded(retentionLimits.activityCountPerWorld),
  serverLogFilesPerWorld: bounded(retentionLimits.serverLogFilesPerWorld),
  configurationVersionsPerWorld: bounded(retentionLimits.configurationVersionsPerWorld),
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
