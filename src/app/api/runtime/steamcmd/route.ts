import { requireAdmin, errorResponse } from "@/server/http";
import { startJob } from "@/server/services/jobs";
import { ensureSteamCmd } from "@/server/services/steamcmd";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, jobId: await startJob(null, "steamcmd-bootstrap", ensureSteamCmd) }, { status: 202 }); } catch (error) { return errorResponse(error); }
}
