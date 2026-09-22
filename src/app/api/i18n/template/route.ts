import { errorResponse, requireAdmin } from "@/server/http";
import { languageResources } from "@/server/services/localization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    return new Response(`${JSON.stringify(languageResources("en"), null, 2)}\n`, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="psm-next-en.json"' } });
  } catch (error) { return errorResponse(error); }
}
