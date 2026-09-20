import { adoptWorld, createWorld, listWorlds } from "@/server/services/worlds";
import { errorResponse, publicWorld, requireAdmin } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ ok: true, worlds: (await listWorlds()).map((world) => publicWorld(world)) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const body = await request.json(); const world = new URL(request.url).searchParams.get("mode") === "adopt" ? await adoptWorld(body) : await createWorld(body); return Response.json({ ok: true, world: publicWorld(world) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
