import { errorResponse } from "@/server/http";
import { listBackups } from "@/server/services/backups";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, backups: await listBackups((await context.params).id) }); } catch (error) { return errorResponse(error); }
}
