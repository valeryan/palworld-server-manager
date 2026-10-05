import { errorResponse } from "@/server/http";
import { listConfigurationVersions } from "@/server/services/configuration";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ ok: true, versions: await listConfigurationVersions((await context.params).id) }); } catch (error) { return errorResponse(error); }
}
