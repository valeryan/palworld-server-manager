import { errorResponse, requireAdmin } from "@/server/http";
import { languageResources } from "@/server/services/localization";

type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, pack: languageResources((await context.params).code) }); }
  catch (error) { return errorResponse(error); }
}
