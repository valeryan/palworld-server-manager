import { route } from "@/server/http";
import { jobHistoryCounts, listJobs } from "@/server/services/jobs";

export const GET = route(async (request) => ({ jobs: await listJobs(Number(new URL(request.url).searchParams.get("limit") || 100)), summary: jobHistoryCounts() }));
