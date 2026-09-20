import { requireAdmin } from "@/server/http";
import { paths } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  return Response.json({ ok: true, settings: { dataDirectory: paths.data(), database: paths.database(), steamCmd: paths.steamCmd(), logs: paths.logs() } });
}
