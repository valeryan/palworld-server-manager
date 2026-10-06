import { route } from "@/server/http";
import { liveWorldStatus } from "@/server/services/observability";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ status: await liveWorldStatus(id) }));
