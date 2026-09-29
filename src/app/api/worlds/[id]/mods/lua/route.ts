import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { installLuaMod, removeLuaMod, setLuaModEnabled } from "@/server/mods/lua-mods";
import { getWorld } from "@/server/services/worlds";
import { worldIsLocked } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["install", "replace"]), artifactId: z.string().min(1) }).strict(),
  z.object({ action: z.enum(["enable", "disable", "remove"]), name: z.string().min(1).max(64) }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const worldId = (await context.params).id; const input = actionSchema.parse(await request.json());
    const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
    if (worldIsLocked(worldId)) throw new Error("Another operation is already running for this world.");
    if ("artifactId" in input) await installLuaMod(world, input.artifactId, { replace: input.action === "replace" });
    else if (input.action === "remove") await removeLuaMod(world, input.name);
    else await setLuaModEnabled(world, input.name, input.action === "enable");
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
