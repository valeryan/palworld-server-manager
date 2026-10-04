import packageJson from "../../../../../package.json";
import { requireAdmin } from "@/server/http";
import { applicationUpdateStatus } from "@/server/services/application-update";
import { getUpdateChannel, updateChecksDisabled } from "@/server/services/update-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  const version = process.env.PSM_APP_VERSION || packageJson.version;
  return Response.json({ ok: true, status: await applicationUpdateStatus(version, { channel: await getUpdateChannel(version), disabled: updateChecksDisabled() }) });
}
