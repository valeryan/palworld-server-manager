import { z } from "zod";
import { route } from "@/server/http";
import { jobHistoryCounts, listJobs } from "@/server/services/jobs";

// Without a scope the listing covers every operation; `scope=app` lists the manager's own and
// `worldId` one world's. The two filters are exclusive.
const querySchema = z.object({ limit: z.coerce.number().int().optional(), scope: z.enum(["app"]).optional(), worldId: z.string().min(1).max(64).optional() }).refine((value) => !(value.scope && value.worldId), "Use scope or worldId, not both.");

export const GET = route(async (request) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const scope = { app: query.scope === "app", worldId: query.worldId };
  return { jobs: await listJobs(query.limit ?? 100, scope), summary: jobHistoryCounts(scope) };
});
