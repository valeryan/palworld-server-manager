import { errorResponse, requireAdmin } from "@/server/http";
import { deleteBackup } from "@/server/services/backups";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; backupId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id, backupId } = await context.params; await deleteBackup(id, backupId); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
