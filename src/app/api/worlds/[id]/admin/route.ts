import { restAdminActionSchema } from "@/contracts/admin";
import { route } from "@/server/http";
import { runRestAdminAction } from "@/server/services/administration";

export const POST = route<{ id: string }>(async (request, { id }) => ({ result: await runRestAdminAction(id, restAdminActionSchema.parse(await request.json())) }));
