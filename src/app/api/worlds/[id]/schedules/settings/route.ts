import { route } from "@/server/http";
import { getMaintenanceSettings, updateMaintenanceSettings } from "@/server/services/schedules";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ settings: await getMaintenanceSettings(id) }));
export const PUT = route<{ id: string }>(async (request, { id }) => ({ settings: await updateMaintenanceSettings(id, await request.json()) }));
