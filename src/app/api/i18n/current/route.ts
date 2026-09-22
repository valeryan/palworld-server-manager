import { errorResponse } from "@/server/http";
import { languageCatalog, languageResources } from "@/server/services/localization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { const catalog = await languageCatalog(); return Response.json({ ok: true, pack: languageResources(catalog.active) }); }
  catch (error) { return errorResponse(error); }
}
