import { errorResponse } from "@/server/http";
import { authorizeRemote } from "@/server/services/remote-access";

export async function GET(request: Request) {
  try { const principal = await authorizeRemote(request, "world.view"); return Response.json({ ok: true, session: principal }); }
  catch (error) { return errorResponse(error); }
}
