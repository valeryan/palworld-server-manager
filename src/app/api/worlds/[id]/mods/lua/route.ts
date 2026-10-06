import { z } from "zod";
import { route } from "@/server/http";
import { installLuaMod, removeLuaMod, setLuaModEnabled } from "@/server/mods/lua-mods";
import { withLockedWorld } from "@/server/services/jobs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["install", "replace"]), artifactId: z.string().min(1) }).strict(),
  z.object({ action: z.enum(["enable", "disable", "remove"]), name: z.string().min(1).max(64) }).strict(),
]);

export const POST = route<{ id: string }>(async (request, { id }) => {
  const input = actionSchema.parse(await request.json());
  // The world is read inside the lock, so the stopped check sees any start that finished just before.
  await withLockedWorld(id, async (world) => {
    if ("artifactId" in input) await installLuaMod(world, input.artifactId, { replace: input.action === "replace" });
    else if (input.action === "remove") await removeLuaMod(world, input.name);
    else await setLuaModEnabled(world, input.name, input.action === "enable");
  });
});
