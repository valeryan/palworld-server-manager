import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { removeLuaMod, setLuaModEnabled } from "@/server/mods/lua-mods";
import { installRelay, RELAYS } from "@/server/mods/relays";
import { withWorldLock } from "@/server/services/jobs";
import { getWorld } from "@/server/services/worlds";

const actionSchema = z.object({ action: z.enum(["install", "replace", "enable", "disable", "remove"]), relay: z.enum(["death-relay", "broadcast"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const worldId = (await context.params).id; const { action, relay } = actionSchema.parse(await request.json());
    await withWorldLock(worldId, async () => {
      // Read inside the lock, so the stopped check sees any start that finished just before.
      const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
      if (action === "install" || action === "replace") await installRelay(world, relay, { replace: action === "replace" });
      else if (action === "remove") await removeLuaMod(world, RELAYS[relay].folder);
      else await setLuaModEnabled(world, RELAYS[relay].folder, action === "enable");
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
