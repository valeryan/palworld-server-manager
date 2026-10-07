import { route } from "@/server/http";
import { knownPlayers } from "@/server/services/observability";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ players: await knownPlayers(id) }));
