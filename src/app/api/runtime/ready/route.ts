import { sqliteClient } from "@/server/db";
import { hostCapabilities } from "@/server/host";
import { route } from "@/server/http";
import { steamCmdHost } from "@/server/services/steamcmd";

export const GET = route(() => {
  sqliteClient().prepare("SELECT 1").get();
  const ready = globalThis.__psmRuntimeStarted === true;
  return Response.json({ ok: ready, pid: process.pid, session: process.env.PSM_LAUNCH_SESSION, host: hostCapabilities(), steamcmd: steamCmdHost() }, { status: ready ? 200 : 503 });
});
