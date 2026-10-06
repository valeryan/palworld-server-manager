import { route } from "@/server/http";
import { liveWorldStatus } from "@/server/services/observability";
import { authorizeRemote } from "@/server/services/remote-access";

export const GET = route<{ id: string }>(async (request, { id }) => {
  await authorizeRemote(request, "world.players", id);
  const status = await liveWorldStatus(id);
  return { reachable: status.reachable, players: status.players };
}, { admin: false });
