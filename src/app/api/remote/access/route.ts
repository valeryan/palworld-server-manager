import { z } from "zod";
import { updateRemoteCodeSchema } from "@/contracts/remote-access";
import { errorResponse, requireAdmin } from "@/server/http";
import { createRemoteCode, deleteRemoteCode, listRemoteAccess, revokeRemoteSessions, setRemoteAccessEnabled, updateRemoteCode } from "@/server/services/remote-access";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-enabled"), enabled: z.boolean() }),
  z.object({ action: z.literal("create-code"), value: z.unknown() }),
  z.object({ action: z.literal("update-code"), id: z.string().uuid(), value: updateRemoteCodeSchema }),
  z.object({ action: z.literal("delete-code"), id: z.string().uuid() }),
  z.object({ action: z.literal("revoke-sessions"), codeId: z.string().uuid().optional() }),
]);
export async function GET(request: Request) { const denied = requireAdmin(request); if (denied) return denied; try { return Response.json({ ok: true, ...(await listRemoteAccess()) }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const input = actionSchema.parse(await request.json());
    if (input.action === "set-enabled") return Response.json({ ok: true, settings: await setRemoteAccessEnabled(input.enabled) });
    if (input.action === "create-code") return Response.json({ ok: true, code: await createRemoteCode(input.value) }, { status: 201 });
    if (input.action === "update-code") await updateRemoteCode(input.id, input.value.enabled);
    else if (input.action === "delete-code") await deleteRemoteCode(input.id);
    else await revokeRemoteSessions(input.codeId);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
