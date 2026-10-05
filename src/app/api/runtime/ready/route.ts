import { requireAdmin } from "@/server/http";
import { sqliteClient } from "@/server/db";
import { steamCmdHost } from "@/server/services/steamcmd";
import { hostCapabilities } from "@/server/host";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  sqliteClient().prepare("SELECT 1").get();
  const ready = globalThis.__psmRuntimeStarted === true;
  return Response.json({ ok: ready, pid: process.pid, session: process.env.PSM_LAUNCH_SESSION, host: hostCapabilities(), steamcmd: steamCmdHost() }, { status: ready ? 200 : 503 });
}
