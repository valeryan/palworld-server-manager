import { requireAdmin } from "@/server/http";
import { beginDrain } from "@/server/services/jobs";
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  if (request.headers.get("x-psm-launch-session") !== process.env.PSM_LAUNCH_SESSION || !process.env.PSM_LAUNCH_SESSION) return Response.json({ ok: false }, { status: 403 });
  return Response.json({ ok: true, active: beginDrain(), session: process.env.PSM_LAUNCH_SESSION });
}
