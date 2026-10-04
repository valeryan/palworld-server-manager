import { errorResponse, requireAdmin } from "@/server/http";
import { paths } from "@/server/paths";
import { getTheme, saveTheme } from "@/server/services/appearance";
import { getRetentionSettings, saveRetentionSettings } from "@/server/services/retention";
import { getUpdateChannel, saveUpdateChannel, updateChecksDisabled } from "@/server/services/update-channel";
import packageJson from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  const [theme, retention, updateChannel] = await Promise.all([getTheme(), getRetentionSettings(), getUpdateChannel(process.env.PSM_APP_VERSION || packageJson.version)]);
  return Response.json({ ok: true, settings: { dataDirectory: paths.data(), database: paths.database(), steamCmd: paths.steamCmd(), logs: paths.logs(), retention, theme, updateChannel, updateChecksDisabled: updateChecksDisabled() ?? null } });
}

export async function PATCH(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const body = await request.json() as { retention?: unknown; theme?: unknown; updateChannel?: unknown };
    if (body.theme !== undefined) return Response.json({ ok: true, settings: { theme: await saveTheme(body.theme) } });
    if (body.updateChannel !== undefined) return Response.json({ ok: true, settings: { updateChannel: await saveUpdateChannel(body.updateChannel) } });
    if (body.retention !== undefined) return Response.json({ ok: true, ...(await saveRetentionSettings(body.retention)) });
    throw new Error("No supported application setting was provided.");
  }
  catch (error) { return errorResponse(error); }
}
