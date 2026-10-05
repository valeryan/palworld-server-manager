import { errorResponse, requireAdmin } from "@/server/http";
import { downloadArtifact } from "@/server/mods/library";

export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { return Response.json({ ok: true, jobId: await downloadArtifact((await context.params).artifactId) }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
