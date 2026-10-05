import { z } from "zod";

export const scheduleActionSchema = z.enum(["backup", "restart", "stop", "update", "system_message", "onscreen_notice", "custom_http", "idle_stop"]);
export const scheduleModeSchema = z.enum(["interval", "minutes", "daily", "on_join"]);
const messageActions = new Set(["system_message", "onscreen_notice"]);
const timedActions = new Set(["backup", "restart", "stop", "update", "system_message", "onscreen_notice", "custom_http"]);

export const createScheduleSchema = z.object({
  action: scheduleActionSchema,
  mode: scheduleModeSchema,
  intervalHours: z.coerce.number().int().min(1).max(720).optional(),
  intervalMinutes: z.coerce.number().int().min(1).max(43_200).optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  message: z.string().trim().max(2_000).optional(),
  joinMatch: z.string().trim().max(128).optional(),
  joinDelaySeconds: z.coerce.number().int().min(0).max(3_600).optional(),
  httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  httpUrl: z.url().max(4_096).optional(),
  httpHeaders: z.string().max(8_192).optional(),
  httpBody: z.string().max(100_000).optional(),
  enabled: z.boolean().default(true),
}).superRefine((input, context) => {
  if (input.mode === "interval" && input.intervalHours == null && input.intervalMinutes == null) context.addIssue({ code: "custom", path: ["intervalHours"], message: "An hourly interval is required." });
  if (input.mode === "minutes" && input.intervalMinutes == null) context.addIssue({ code: "custom", path: ["intervalMinutes"], message: "A minute interval is required." });
  if (input.mode === "daily" && !input.timeOfDay) context.addIssue({ code: "custom", path: ["timeOfDay"], message: "A daily time is required." });
  if (input.mode === "on_join" && !messageActions.has(input.action)) context.addIssue({ code: "custom", path: ["mode"], message: "Player-join triggers are available only for messages and notices." });
  if (input.action === "idle_stop" && input.mode !== "interval" && input.mode !== "minutes") context.addIssue({ code: "custom", path: ["mode"], message: "Stop-when-empty requires an hour or minute interval." });
  if (input.action !== "idle_stop" && input.mode !== "on_join" && !timedActions.has(input.action)) context.addIssue({ code: "custom", path: ["action"], message: "This action cannot use a timed schedule." });
  if (messageActions.has(input.action) && !input.message) context.addIssue({ code: "custom", path: ["message"], message: "A message is required." });
  if (input.action === "custom_http") {
    if (!input.httpUrl) context.addIssue({ code: "custom", path: ["httpUrl"], message: "A URL is required." });
    else {
      const url = new URL(input.httpUrl);
      if (!/^https?:$/i.test(url.protocol)) context.addIssue({ code: "custom", path: ["httpUrl"], message: "Only HTTP and HTTPS URLs are supported." });
      if (url.username || url.password) context.addIssue({ code: "custom", path: ["httpUrl"], message: "Credentials are not allowed in the URL; use a request header." });
    }
  }
});

export const updateScheduleSchema = z.object({ enabled: z.boolean().optional(), skipNext: z.boolean().optional() });

export const maintenanceSettingsSchema = z.object({
  warningEnabled: z.boolean().default(false),
  warningLeadMinutes: z.coerce.number().int().min(1).max(120).default(10),
  warningIntervalMinutes: z.coerce.number().int().min(0).max(120).default(2),
  warningMessage: z.string().trim().min(1).max(500).default("The server will {action} in {minutes} minute(s). Please get to a safe place."),
});

export type MaintenanceSettingsInput = z.infer<typeof maintenanceSettingsSchema>;
