import { requireAdmin, errorResponse } from "@/server/http";
import { canonicalInstallDir } from "@/server/services/worlds";
import { inspectInstallation } from "@/server/services/installation";
import { z } from "zod";
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const input = z.object({ installDir: z.string().min(1), platform: z.enum(["linux", "windows"]).optional() }).parse(await request.json()); return Response.json({ ok: true, inspection: await inspectInstallation(await canonicalInstallDir(input.installDir), input.platform) }); } catch (error) { return errorResponse(error); }
}
