import { createWorld, listWorlds } from "@/server/services/worlds";
import { errorResponse, publicWorld, requireAdmin } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ ok: true, worlds: (await listWorlds()).map((world) => publicWorld(world)) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, world: publicWorld(await createWorld(await request.json())) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
