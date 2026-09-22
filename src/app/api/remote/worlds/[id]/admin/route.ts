import { restAdminActionSchema } from "@/contracts/admin";
import { errorResponse } from "@/server/http";
import { runRestAdminAction } from "@/server/services/administration";
import { auditPrincipal, authorizeRemote, remoteAccessErrorResponse } from "@/server/services/remote-access";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const action = restAdminActionSchema.parse(await request.json());
    if (action.action === "save") throw new Error("Remote save is not an available scoped action.");
    const permission = action.action === "announce" ? "world.messages" : "world.players";
    const principal = await authorizeRemote(request, permission, id); const result = await runRestAdminAction(id, action);
    await auditPrincipal(request, principal, `world.${action.action}`, id, "userId" in action ? `${action.action} ${action.playerName ?? action.userId}` : "Sent an announcement");
    return Response.json({ ok: true, result });
  } catch (error) { return remoteAccessErrorResponse(error) ?? errorResponse(error); }
}
