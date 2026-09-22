import { errorResponse } from "@/server/http";
import { worldActivity } from "@/server/services/observability";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const limit = Number(new URL(request.url).searchParams.get("limit") || 25); return Response.json({ ok: true, activity: await worldActivity((await context.params).id, limit) }); } catch (error) { return errorResponse(error); }
}
