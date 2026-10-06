import { z } from "zod";
import { route } from "@/server/http";
import { removeLuaMod, setLuaModEnabled } from "@/server/mods/lua-mods";
import { installRelay, RELAYS } from "@/server/mods/relays";
import { withLockedWorld } from "@/server/services/jobs";

const actionSchema = z.object({ action: z.enum(["install", "replace", "enable", "disable", "remove"]), relay: z.enum(["death-relay", "broadcast"]) }).strict();

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { action, relay } = actionSchema.parse(await request.json());
  await withLockedWorld(id, async (world) => {
    if (action === "install" || action === "replace") await installRelay(world, relay, { replace: action === "replace" });
    else if (action === "remove") await removeLuaMod(world, RELAYS[relay].folder);
    else await setLuaModEnabled(world, RELAYS[relay].folder, action === "enable");
  });
});
