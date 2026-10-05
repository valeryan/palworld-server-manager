import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { reconcileConfiguration } from "@/server/services/configuration";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const input = z.object({ action: z.enum(["import-file", "reapply-desired"]) }).strict().parse(await request.json());
    return Response.json({ ok: true, result: await reconcileConfiguration((await context.params).id, input.action) });
  } catch (error) { return errorResponse(error); }
}
