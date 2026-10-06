import { z } from "zod";
import { route } from "@/server/http";
import { startJob } from "@/server/services/jobs";
import { lifecycleTask } from "@/server/services/lifecycle";
import { auditPrincipal, authorizeRemote } from "@/server/services/remote-access";
import { requireWorld } from "@/server/services/worlds";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const principal = await authorizeRemote(request, "world.lifecycle", id);
  const input = z.object({ action: z.enum(["start", "stop", "restart"]) }).parse(await request.json());
  const world = await requireWorld(id);
  const jobId = await startJob(id, input.action, lifecycleTask(id, input.action));
  await auditPrincipal(request, principal, `world.${input.action}`, id, `${input.action} requested for ${world.displayName}`);
  return { jobId };
}, { admin: false, status: 202 });
