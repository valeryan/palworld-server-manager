import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { importLegacyDatabase } from "@/server/services/legacy-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ sourcePath: z.string().min(1), pathMappings: z.record(z.string(), z.string()).default({}) });

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const input = inputSchema.parse(await request.json()); return Response.json({ ok: true, report: await importLegacyDatabase(input.sourcePath, input.pathMappings) }); }
  catch (error) { return errorResponse(error); }
}
