import { rconCommandSchema } from "@/contracts/admin";
import { errorResponse, requireAdmin } from "@/server/http";
import { runLegacyRconCommand } from "@/server/services/legacy-rcon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { command } = rconCommandSchema.parse(await request.json());
    return Response.json({ ok: true, output: await runLegacyRconCommand((await context.params).id, command) });
  } catch (error) { return errorResponse(error); }
}
