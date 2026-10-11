import { sqliteClient } from "@/server/db";
import { hostCapabilities } from "@/server/host";
import { route } from "@/server/http";
import { runtimePhase } from "@/server/services/runtime-phase";
import { steamCmdHost } from "@/server/services/steamcmd";

export const GET = route(() => {
  sqliteClient().prepare("SELECT 1").get();
  const phase = runtimePhase(); const ready = phase !== undefined;
  return Response.json({ ok: ready, phase, pid: process.pid, session: process.env.PSM_LAUNCH_SESSION, host: hostCapabilities(), steamcmd: steamCmdHost() }, { status: ready ? 200 : 503 });
});
