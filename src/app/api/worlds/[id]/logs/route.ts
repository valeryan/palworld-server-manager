import { route } from "@/server/http";
import { worldLogs } from "@/server/services/observability";

export const GET = route<{ id: string }>(async (request, { id }) => ({ logs: await worldLogs(id, new URL(request.url).searchParams.get("file") ?? undefined) }));
