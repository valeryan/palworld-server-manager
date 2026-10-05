import { errorResponse, requireAdmin } from "@/server/http";
import { getJob } from "@/server/services/jobs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const job = await getJob((await context.params).id);
    if (!job) throw new Error("Job not found.");
    return Response.json({ ok: true, job });
  } catch (error) { return errorResponse(error); }
}
