import { errorResponse, requireAdmin } from "@/server/http";
import { paths } from "@/server/paths";
import { getRetentionSettings, saveRetentionSettings } from "@/server/services/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  return Response.json({ ok: true, settings: { dataDirectory: paths.data(), database: paths.database(), steamCmd: paths.steamCmd(), logs: paths.logs(), retention: await getRetentionSettings() } });
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, ...(await saveRetentionSettings((await request.json()).retention)) }); }
  catch (error) { return errorResponse(error); }
}
