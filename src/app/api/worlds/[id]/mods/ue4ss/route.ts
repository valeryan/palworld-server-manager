import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { installUe4ss, removeUe4ss, setUe4ssEnabled } from "@/server/mods/ue4ss-runtime";
import { startJob } from "@/server/services/jobs";
import { getWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({ action: z.enum(["install", "replace", "enable", "disable", "remove"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const worldId = (await context.params).id; const { action } = actionSchema.parse(await request.json());
    const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
    if (action === "enable" || action === "disable") { await setUe4ssEnabled(world, action === "enable"); return Response.json({ ok: true }); }
    // Checked again inside the operation, which holds the world lock.
    const current = async () => { const latest = await getWorld(worldId); if (!latest) throw new Error("World not found."); return latest; };
    const jobId = action === "remove"
      ? await startJob(worldId, "mod-remove", async (job) => removeUe4ss(await current(), job))
      : await startJob(worldId, "mod-install", async (job) => installUe4ss(await current(), { replace: action === "replace" }, job));
    return Response.json({ ok: true, jobId }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
