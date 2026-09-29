import packageJson from "../../../../../package.json";
import { requireAdmin } from "@/server/http";
import { applicationUpdateStatus } from "@/server/services/application-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  return Response.json({ ok: true, status: await applicationUpdateStatus(process.env.PSM_APP_VERSION || packageJson.version) });
}
