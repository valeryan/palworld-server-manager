import { errorResponse } from "@/server/http";
import { liveWorldStatus } from "@/server/services/observability";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, status: await liveWorldStatus((await context.params).id) }); } catch (error) { return errorResponse(error); }
}
