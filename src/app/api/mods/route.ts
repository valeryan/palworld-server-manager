import { errorResponse } from "@/server/http";
import { modLibrary } from "@/server/mods/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ ok: true, library: await modLibrary() }); }
  catch (error) { return errorResponse(error); }
}
