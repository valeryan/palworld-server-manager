import { route } from "@/server/http";
import { startJob } from "@/server/services/jobs";
import { ensureSteamCmd } from "@/server/services/steamcmd";

export const POST = route(async () => ({ jobId: await startJob(null, "steamcmd-bootstrap", ensureSteamCmd) }), { status: 202 });
