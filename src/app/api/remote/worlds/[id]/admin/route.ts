import { restAdminActionSchema } from "@/contracts/admin";
import { ConflictError } from "@/server/errors";
import { route } from "@/server/http";
import { runRestAdminAction } from "@/server/services/administration";
import { auditPrincipal, authorizeRemote } from "@/server/services/remote-access";

export const POST = route<{ id: string }>(async (request, { id }) => {
  // Authorise before reporting anything about the body, so an unauthenticated caller only ever sees 401.
  const parsed = restAdminActionSchema.safeParse(await request.json().catch(() => null));
  const permission = parsed.success && parsed.data.action === "announce" ? "world.messages" : "world.players";
  const principal = await authorizeRemote(request, permission, id);
  if (!parsed.success) throw parsed.error;
  const action = parsed.data;
  if (action.action === "save") throw new ConflictError("Remote save is not an available scoped action.");
  const result = await runRestAdminAction(id, action);
  await auditPrincipal(request, principal, `world.${action.action}`, id, "userId" in action ? `${action.action} ${action.playerName ?? action.userId}` : "Sent an announcement");
  return { result };
}, { admin: false });
