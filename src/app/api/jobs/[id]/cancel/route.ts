import { errorResponse, requireAdmin } from "@/server/http";
import { cancelJob } from "@/server/services/jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; await cancelJob(id); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
