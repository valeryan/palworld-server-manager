import { authorizeRemote, remoteAccessErrorResponse } from "@/server/services/remote-access";

export async function GET(request: Request) {
  try { const principal = await authorizeRemote(request, "world.view"); return Response.json({ ok: true, session: principal }); }
  catch (error) { return remoteAccessErrorResponse(error) ?? Response.json({ ok: false, error: "Remote session unavailable." }, { status: 500 }); }
}
