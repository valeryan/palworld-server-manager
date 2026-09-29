import { errorResponse, requireAdmin } from "@/server/http";
import { MOD_CATALOG } from "@/server/mods/catalog";
import { removeArtifact } from "@/server/mods/library";
import { removeLuaArtifact } from "@/server/mods/lua-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const id = (await context.params).artifactId;
    if (MOD_CATALOG.some((entry) => entry.id === id)) await removeArtifact(id); else await removeLuaArtifact(id);
    return Response.json({ ok: true });
  }
  catch (error) { return errorResponse(error); }
}
