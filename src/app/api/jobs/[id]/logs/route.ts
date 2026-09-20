import { errorResponse } from "@/server/http";
import { listJobLogs } from "@/server/services/jobs";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const limit = Number(new URL(request.url).searchParams.get("limit") || 1_000); return Response.json({ ok: true, logs: await listJobLogs((await context.params).id, limit) }); } catch (error) { return errorResponse(error); }
}
