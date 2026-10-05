import { route } from "@/server/http";
import { listBackups } from "@/server/services/backups";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ backups: await listBackups(id) }));
