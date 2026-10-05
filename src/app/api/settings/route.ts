import { ConflictError } from "@/server/errors";
import { route } from "@/server/http";
import { paths } from "@/server/paths";
import { getTheme, saveTheme } from "@/server/services/appearance";
import { getRetentionSettings, saveRetentionSettings } from "@/server/services/retention";
import { getUpdateChannel, saveUpdateChannel, updateChecksDisabled } from "@/server/services/update-channel";
import packageJson from "../../../../package.json";

export const GET = route(async () => {
  const [theme, retention, updateChannel] = await Promise.all([getTheme(), getRetentionSettings(), getUpdateChannel(process.env.PSM_APP_VERSION || packageJson.version)]);
  return { settings: { dataDirectory: paths.data(), database: paths.database(), steamCmd: paths.steamCmd(), logs: paths.logs(), retention, theme, updateChannel, updateChecksDisabled: updateChecksDisabled() ?? null } };
});

// Every provided setting is applied; the response echoes each one that changed.
export const PATCH = route(async (request) => {
  const body = await request.json() as { retention?: unknown; theme?: unknown; updateChannel?: unknown };
  const settings: Record<string, unknown> = {}; let report: unknown;
  if (body.theme !== undefined) settings.theme = await saveTheme(body.theme);
  if (body.updateChannel !== undefined) settings.updateChannel = await saveUpdateChannel(body.updateChannel);
  if (body.retention !== undefined) { const saved = await saveRetentionSettings(body.retention); settings.retention = saved.settings; report = saved.report; }
  if (!Object.keys(settings).length) throw new ConflictError("No supported application setting was provided.");
  return { settings, ...(report === undefined ? {} : { report }) };
});
