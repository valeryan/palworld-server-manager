import { publicWorld } from "@/server/http";
import { authorizeRemote, remoteAccessErrorResponse } from "@/server/services/remote-access";
import { listWorlds } from "@/server/services/worlds";

export async function GET(request: Request) {
  try {
    const principal = await authorizeRemote(request, "world.view");
    const worlds = (await listWorlds()).filter((world) => principal.scope === "all" || world.id === principal.worldId).map(publicWorld);
    return Response.json({ ok: true, worlds, session: principal });
  } catch (error) { return remoteAccessErrorResponse(error) ?? Response.json({ ok: false, error: "Remote worlds unavailable." }, { status: 500 }); }
}
