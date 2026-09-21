import { z } from "zod";

export const backupSettingsSchema = z.object({
  destinationDir: z.string().trim().max(4096).nullable().default(null),
  retentionCount: z.coerce.number().int().min(0).max(500).default(0),
});

export type BackupSettingsInput = z.infer<typeof backupSettingsSchema>;
