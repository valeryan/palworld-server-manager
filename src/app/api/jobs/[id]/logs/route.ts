import { route } from "@/server/http";
import { listJobLogs } from "@/server/services/jobs";

export const GET = route<{ id: string }>(async (request, { id }) => ({ logs: await listJobLogs(id, Number(new URL(request.url).searchParams.get("limit") || 1_000)) }));
