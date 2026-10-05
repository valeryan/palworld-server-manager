import { route } from "@/server/http";
import { repairManagedMods } from "@/server/mods/integrity";
import { startJob } from "@/server/services/jobs";
import { requireWorld } from "@/server/services/worlds";

export const POST = route<{ id: string }>(async (_request, { id }) => {
  await requireWorld(id);
  return { jobId: await startJob(id, "mod-repair", async (job) => repairManagedMods(await requireWorld(id), job)) };
}, { status: 202 });
