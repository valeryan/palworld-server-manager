import { errorResponse } from "@/server/http";
import { libraryLuaMods, libraryRelays, modLibrary } from "@/server/mods/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { const [library, luaMods, relays] = await Promise.all([modLibrary(), libraryLuaMods(), libraryRelays()]); return Response.json({ ok: true, library, luaMods, relays }); }
  catch (error) { return errorResponse(error); }
}
