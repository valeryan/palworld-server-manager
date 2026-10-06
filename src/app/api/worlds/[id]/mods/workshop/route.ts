import { z } from "zod";
import { route } from "@/server/http";
import { setWorkshopEnabled, setWorkshopModActive } from "@/server/mods/workshop-mods";
import { withLockedWorld } from "@/server/services/jobs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["enable-all", "disable-all"]) }).strict(),
  z.object({ action: z.enum(["activate", "deactivate"]), packageName: z.string().min(1).max(200) }).strict(),
]);

export const POST = route<{ id: string }>(async (request, { id }) => {
  const input = actionSchema.parse(await request.json());
  await withLockedWorld(id, async (world) => {
    if ("packageName" in input) await setWorkshopModActive(world, input.packageName, input.action === "activate");
    else await setWorkshopEnabled(world, input.action === "enable-all");
  });
});
