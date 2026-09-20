import { errorResponse } from "@/server/http";
import { worldActivity } from "@/server/services/observability";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, activity: await worldActivity((await context.params).id) }); } catch (error) { return errorResponse(error); }
}
