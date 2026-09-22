import { errorResponse, publicWorld, requireAdmin } from "@/server/http";
import { getWorld, unregisterWorld, updateWorld } from "@/server/services/worlds";
import { needsManagedConfigurationSync, syncManagedConfiguration } from "@/server/services/configuration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const { id } = await context.params; const world = await getWorld(id); return world ? Response.json({ ok: true, world: publicWorld(world) }) : Response.json({ ok: false, error: "World not found." }, { status: 404 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; const previous = await getWorld(id); if (!previous) throw new Error("World not found."); const input: unknown = await request.json(); const world = await updateWorld(id, input); let configuration;
    try { configuration = needsManagedConfigurationSync(input) ? await syncManagedConfiguration(id, { syncPublicPort: previous.gamePort !== world.gamePort }) : { synchronized: false, skipped: true, reason: "No PalWorldSettings.ini-backed values changed." }; }
    catch (error) { configuration = { synchronized: false, reason: error instanceof Error ? error.message : String(error) }; }
    return Response.json({ ok: true, world: publicWorld(world), configuration }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; await unregisterWorld(id); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
