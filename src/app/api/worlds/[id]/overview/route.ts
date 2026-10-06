import { route } from "@/server/http";
import { worldOverview } from "@/server/services/overview";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ overview: await worldOverview(id) }));
