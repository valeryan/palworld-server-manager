import { errorResponse } from "@/server/http";
import { libraryLuaMods, modLibrary } from "@/server/mods/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { const [library, luaMods] = await Promise.all([modLibrary(), libraryLuaMods()]); return Response.json({ ok: true, library, luaMods }); }
  catch (error) { return errorResponse(error); }
}
