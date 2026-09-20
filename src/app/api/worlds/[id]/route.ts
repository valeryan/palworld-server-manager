import { errorResponse, publicWorld, requireAdmin } from "@/server/http";
import { getWorld, unregisterWorld, updateWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const { id } = await context.params; const world = await getWorld(id); return world ? Response.json({ ok: true, world: publicWorld(world) }) : Response.json({ ok: false, error: "World not found." }, { status: 404 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; return Response.json({ ok: true, world: publicWorld(await updateWorld(id, await request.json())) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; await unregisterWorld(id); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
