import { errorResponse } from "@/server/http";
import { worldLogs } from "@/server/services/observability";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, logs: await worldLogs((await context.params).id, new URL(request.url).searchParams.get("file") ?? undefined) }); } catch (error) { return errorResponse(error); }
}
