import { errorResponse, requireAdmin } from "@/server/http";
import { installLanguagePack, languageCatalog, removeLanguagePack, selectLanguage } from "@/server/services/localization";

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, catalog: await languageCatalog() }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const body = await request.json() as { action?: unknown; code?: unknown; content?: unknown };
    if (body.action === "select" && typeof body.code === "string") return Response.json({ ok: true, catalog: await selectLanguage(body.code) });
    if (body.action === "install" && typeof body.content === "string") return Response.json({ ok: true, catalog: await installLanguagePack(body.content) });
    throw new Error("Choose a language or provide a language-pack file.");
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const code = new URL(request.url).searchParams.get("code");
    if (!code) throw new Error("Language code is required.");
    return Response.json({ ok: true, catalog: await removeLanguagePack(code) });
  } catch (error) { return errorResponse(error); }
}
