import { errorResponse } from "@/server/http";
import { jobHistoryCounts, listJobs } from "@/server/services/jobs";

export async function GET(request: Request) {
  try { const limit = Number(new URL(request.url).searchParams.get("limit") || 100); return Response.json({ ok: true, jobs: await listJobs(limit), summary: jobHistoryCounts() }); }
  catch (error) { return errorResponse(error); }
}
