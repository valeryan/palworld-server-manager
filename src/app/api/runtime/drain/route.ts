import { ForbiddenError } from "@/server/errors";
import { route } from "@/server/http";
import { beginDrain } from "@/server/services/jobs";

// Only the Electron launcher that started this server may drain it.
export const POST = route((request) => {
  if (!process.env.PSM_LAUNCH_SESSION || request.headers.get("x-psm-launch-session") !== process.env.PSM_LAUNCH_SESSION) throw new ForbiddenError("Drain requests must come from this manager's launcher.");
  return { active: beginDrain(), session: process.env.PSM_LAUNCH_SESSION };
});
