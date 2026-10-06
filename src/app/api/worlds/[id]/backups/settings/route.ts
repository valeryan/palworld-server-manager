import { route } from "@/server/http";
import { getBackupSettings, updateBackupSettings } from "@/server/services/backups";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ settings: await getBackupSettings(id) }));
export const PUT = route<{ id: string }>(async (request, { id }) => ({ settings: await updateBackupSettings(id, await request.json()) }));
