import { z } from "zod";

export const createScheduleSchema = z.discriminatedUnion("mode", [
  z.object({ action: z.enum(["backup", "restart"]), mode: z.literal("interval"), intervalMinutes: z.coerce.number().int().min(1).max(43_200), enabled: z.boolean().default(true) }),
  z.object({ action: z.enum(["backup", "restart"]), mode: z.literal("daily"), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), enabled: z.boolean().default(true) }),
]);

export const updateScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  skipNext: z.boolean().optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
