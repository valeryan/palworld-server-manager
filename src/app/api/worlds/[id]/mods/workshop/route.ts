import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { setWorkshopEnabled, setWorkshopModActive } from "@/server/mods/workshop-mods";
import { getWorld } from "@/server/services/worlds";
import { worldIsLocked } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["enable-all", "disable-all"]) }).strict(),
  z.object({ action: z.enum(["activate", "deactivate"]), packageName: z.string().min(1).max(200) }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const worldId = (await context.params).id; const input = actionSchema.parse(await request.json());
    const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
    if (worldIsLocked(worldId)) throw new Error("Another operation is already running for this world.");
    if ("packageName" in input) await setWorkshopModActive(world, input.packageName, input.action === "activate");
    else await setWorkshopEnabled(world, input.action === "enable-all");
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
