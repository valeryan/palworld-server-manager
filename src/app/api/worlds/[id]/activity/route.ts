import { route } from "@/server/http";
import { worldActivity } from "@/server/services/observability";

export const GET = route<{ id: string }>(async (request, { id }) => ({ activity: await worldActivity(id, Number(new URL(request.url).searchParams.get("limit") || 25)) }));
