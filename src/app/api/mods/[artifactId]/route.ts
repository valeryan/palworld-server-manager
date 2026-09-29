import { errorResponse, requireAdmin } from "@/server/http";
import { removeArtifact } from "@/server/mods/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { await removeArtifact((await context.params).artifactId); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
