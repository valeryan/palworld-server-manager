import { errorResponse, requireAdmin } from "@/server/http";
import { repairManagedMods } from "@/server/mods/integrity";
import { startJob } from "@/server/services/jobs";
import { getWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const worldId = (await context.params).id;
    if (!await getWorld(worldId)) throw new Error("World not found.");
    const jobId = await startJob(worldId, "mod-repair", async (job) => { const world = await getWorld(worldId); if (!world) throw new Error("World not found."); await repairManagedMods(world, job); });
    return Response.json({ ok: true, jobId }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
