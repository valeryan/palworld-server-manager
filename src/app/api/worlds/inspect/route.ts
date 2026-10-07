import { z } from "zod";
import { PLATFORMS } from "@/contracts/world";
import { route } from "@/server/http";
import { inspectInstallation } from "@/server/services/installation";
import { runningServerSummary } from "@/server/services/lifecycle";
import { canonicalInstallDir } from "@/server/services/worlds";

export const POST = route(async (request) => {
  const input = z.object({ installDir: z.string().min(1), platform: z.enum(PLATFORMS).optional() }).parse(await request.json());
  const installDir = await canonicalInstallDir(input.installDir);
  return { inspection: { ...await inspectInstallation(installDir, input.platform), runningServer: await runningServerSummary(installDir) } };
});
