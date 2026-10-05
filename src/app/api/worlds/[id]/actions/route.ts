import { repairPrerequisites } from "@/server/services/prerequisites";
import { worldActionSchema } from "@/contracts/world";
import { errorResponse, requireAdmin } from "@/server/http";
import { startJob } from "@/server/services/jobs";
import { createBackup, restoreBackup } from "@/server/services/backups";
import { startWorld, stopWorld } from "@/server/services/processes";
import { detectLatestBuild, installOrUpdate } from "@/server/services/steamcmd";
import { getWorld } from "@/server/services/worlds";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params; const world = await getWorld(id); if (!world) throw new Error("World not found.");
    const input = worldActionSchema.parse(await request.json());
    const jobId = await startJob(id, input.action, async (job) => {
      if (input.action === "repair-prerequisites") await repairPrerequisites((await getWorld(id))!, job);
      else if (input.action === "start") { await job.update(10, "Starting server process"); await startWorld(id); }
      else if (input.action === "stop") { await job.update(10, input.force ? "Force-stopping server process" : "Requesting graceful server shutdown"); await stopWorld(id, input.force); }
      else if (input.action === "restart") { await job.update(10, "Stopping server"); await stopWorld(id); await job.update(60, "Starting server"); await startWorld(id); }
      else if (input.action === "install" || input.action === "update") await installOrUpdate((await getWorld(id))!, job);
      else if (input.action === "check-update") { await job.update(10, "Contacting Steam for the latest build"); const latest = await detectLatestBuild(id, job.signal); job.log(`Latest public build is ${latest}.`); }
      else if (input.action === "backup") await createBackup(id, input.reason, job);
      else if (input.action === "restore") await restoreBackup(id, input.backupId, job);
    });
    return Response.json({ ok: true, jobId }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
