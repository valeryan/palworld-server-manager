import { liveWorldStatus } from "@/server/services/observability";
import { authorizeRemote, remoteAccessErrorResponse } from "@/server/services/remote-access";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; await authorizeRemote(request, "world.players", id); const status = await liveWorldStatus(id); return Response.json({ ok: true, reachable: status.reachable, players: status.players }); }
  catch (error) { return remoteAccessErrorResponse(error) ?? Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
