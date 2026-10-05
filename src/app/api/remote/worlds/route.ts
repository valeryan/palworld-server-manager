import { publicWorld, route } from "@/server/http";
import { authorizeRemote } from "@/server/services/remote-access";
import { listWorlds } from "@/server/services/worlds";

export const GET = route(async (request) => {
  const principal = await authorizeRemote(request, "world.view");
  const worlds = (await listWorlds()).filter((world) => principal.scope === "all" || world.id === principal.worldId).map(publicWorld);
  return { worlds, session: principal };
}, { admin: false });
