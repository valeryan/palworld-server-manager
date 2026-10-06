import { z } from "zod";
import { updateRemoteCodeSchema } from "@/contracts/remote-access";
import { route } from "@/server/http";
import { createRemoteCode, deleteRemoteCode, listRemoteAccess, revokeRemoteSessions, setRemoteAccessEnabled, updateRemoteCode } from "@/server/services/remote-access";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-enabled"), enabled: z.boolean() }),
  z.object({ action: z.literal("create-code"), value: z.unknown() }),
  z.object({ action: z.literal("update-code"), id: z.string().uuid(), value: updateRemoteCodeSchema }),
  z.object({ action: z.literal("delete-code"), id: z.string().uuid() }),
  z.object({ action: z.literal("revoke-sessions"), codeId: z.string().uuid().optional() }),
]);

export const GET = route(async () => listRemoteAccess());

export const POST = route(async (request) => {
  const input = actionSchema.parse(await request.json());
  if (input.action === "set-enabled") return { settings: await setRemoteAccessEnabled(input.enabled) };
  if (input.action === "create-code") return Response.json({ ok: true, code: await createRemoteCode(input.value) }, { status: 201 });
  if (input.action === "update-code") await updateRemoteCode(input.id, input.value.enabled);
  else if (input.action === "delete-code") await deleteRemoteCode(input.id);
  else await revokeRemoteSessions(input.codeId);
});
