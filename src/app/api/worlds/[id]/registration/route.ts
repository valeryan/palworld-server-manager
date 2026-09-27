import { errorResponse, requireAdmin } from "@/server/http";
import { exportWorldRegistration, getWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const world = await getWorld(id);
    if (!world) return Response.json({ ok: false, error: "World not found." }, { status: 404 });
    return Response.json({ ok: true, registration: exportWorldRegistration(world) });
  } catch (error) { return errorResponse(error); }
}
