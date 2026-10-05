import { worldActionSchema } from "@/contracts/world";
import { route } from "@/server/http";
import { createBackup, restoreBackup } from "@/server/services/backups";
import { startJob } from "@/server/services/jobs";
import { lifecycleTask } from "@/server/services/processes";
import { repairPrerequisites } from "@/server/services/prerequisites";
import { detectLatestBuild, installOrUpdate } from "@/server/services/steamcmd";
import { requireWorld } from "@/server/services/worlds";

export const POST = route<{ id: string }>(async (request, { id }) => {
  await requireWorld(id);
  const input = worldActionSchema.parse(await request.json());
  const jobId = await startJob(id, input.action, async (job) => {
    if (input.action === "start" || input.action === "restart") await lifecycleTask(id, input.action)(job);
    else if (input.action === "stop") await lifecycleTask(id, "stop", input.force)(job);
    else if (input.action === "repair-prerequisites") await repairPrerequisites(await requireWorld(id), job);
    else if (input.action === "install" || input.action === "update") await installOrUpdate(await requireWorld(id), job);
    else if (input.action === "check-update") { await job.update(10, "Contacting Steam for the latest build"); const latest = await detectLatestBuild(id, job.signal); job.log(`Latest public build is ${latest}.`); }
    else if (input.action === "backup") await createBackup(id, input.reason, job);
    else if (input.action === "restore") await restoreBackup(id, input.backupId, job);
  });
  return { jobId };
}, { status: 202 });
