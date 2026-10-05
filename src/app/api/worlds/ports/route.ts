import { suggestWorldPorts } from "@/server/services/worlds";
import { errorResponse, requireAdmin } from "@/server/http";

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, ports: await suggestWorldPorts() }); }
  catch (error) { return errorResponse(error); }
}
