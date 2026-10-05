import { errorResponse } from "@/server/http";
import { worldModStatus } from "@/server/mods/status";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, mods: await worldModStatus((await context.params).id) }); }
  catch (error) { return errorResponse(error); }
}
