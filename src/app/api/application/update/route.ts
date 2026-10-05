import packageJson from "../../../../../package.json";
import { route } from "@/server/http";
import { applicationUpdateStatus } from "@/server/services/application-update";
import { getUpdateChannel, updateChecksDisabled } from "@/server/services/update-channel";

export const GET = route(async () => {
  const version = process.env.PSM_APP_VERSION || packageJson.version;
  return { status: await applicationUpdateStatus(version, { channel: await getUpdateChannel(version), disabled: updateChecksDisabled() }) };
});
