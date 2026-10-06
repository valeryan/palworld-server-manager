import { buildActionSchema } from "@/contracts/builds";
import { route } from "@/server/http";
import { buildSummary, updateOutdatedWorlds } from "@/server/services/builds";
import { startJob } from "@/server/services/jobs";
import { refreshLatestBuild, reinstallSteamCmd } from "@/server/services/steamcmd";

export const GET = route(async () => ({ summary: await buildSummary() }));

// `check` answers inline with the refreshed summary; the other actions start a manager-level job.
export const POST = route(async (request) => {
  const input = buildActionSchema.parse(await request.json());
  if (input.action === "check") { await refreshLatestBuild(request.signal); return { summary: await buildSummary() }; }
  const jobId = input.action === "update-all" ? await startJob(null, "update-all", updateOutdatedWorlds, { singleton: true }) : await startJob(null, "steamcmd-reinstall", reinstallSteamCmd, { singleton: true });
  return Response.json({ ok: true, jobId }, { status: 202 });
});
