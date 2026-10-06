import { z } from "zod";
import { route } from "@/server/http";
import { installUe4ss, removeUe4ss, setUe4ssEnabled } from "@/server/mods/ue4ss-runtime";
import { startJob, withLockedWorld } from "@/server/services/jobs";
import { requireWorld } from "@/server/services/worlds";

const actionSchema = z.object({ action: z.enum(["install", "replace", "enable", "disable", "remove"]) }).strict();

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { action } = actionSchema.parse(await request.json());
  await requireWorld(id);
  if (action === "enable" || action === "disable") { await withLockedWorld(id, (world) => setUe4ssEnabled(world, action === "enable")); return Response.json({ ok: true }); }
  // The world is read again inside the operation, which holds the world lock.
  const jobId = action === "remove"
    ? await startJob(id, "mod-remove", async (job) => removeUe4ss(await requireWorld(id), job))
    : await startJob(id, "mod-install", async (job) => installUe4ss(await requireWorld(id), { replace: action === "replace" }, job));
  return Response.json({ ok: true, jobId }, { status: 202 });
});
