import { z } from "zod";
import { errorResponse } from "@/server/http";
import { startJob } from "@/server/services/jobs";
import { startWorld, stopWorld } from "@/server/services/processes";
import { auditPrincipal, authorizeRemote } from "@/server/services/remote-access";
import { getWorld } from "@/server/services/worlds";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const principal = await authorizeRemote(request, "world.lifecycle", id);
    const input = z.object({ action: z.enum(["start", "stop", "restart"]) }).parse(await request.json());
    const world = await getWorld(id); if (!world) throw new Error("World not found.");
    const jobId = await startJob(id, input.action, async (job) => {
      if (input.action === "start") { await job.update(10, "Starting server process"); await startWorld(id); }
      else if (input.action === "stop") { await job.update(10, "Requesting graceful server shutdown"); await stopWorld(id); }
      else { await job.update(10, "Stopping server"); await stopWorld(id); await job.update(60, "Starting server"); await startWorld(id); }
    });
    await auditPrincipal(request, principal, `world.${input.action}`, id, `${input.action} requested for ${world.displayName}`);
    return Response.json({ ok: true, jobId }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
