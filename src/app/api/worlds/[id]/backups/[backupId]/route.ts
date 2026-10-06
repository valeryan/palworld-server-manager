import { route } from "@/server/http";
import { deleteBackup } from "@/server/services/backups";

export const DELETE = route<{ id: string; backupId: string }>(async (_request, { id, backupId }) => { await deleteBackup(id, backupId); });
