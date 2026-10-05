import { restAdminActionSchema } from "@/contracts/admin";
import { errorResponse, requireAdmin } from "@/server/http";
import { runRestAdminAction } from "@/server/services/administration";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const action = restAdminActionSchema.parse(await request.json());
    return Response.json({ ok: true, result: await runRestAdminAction((await context.params).id, action) });
  } catch (error) { return errorResponse(error); }
}
