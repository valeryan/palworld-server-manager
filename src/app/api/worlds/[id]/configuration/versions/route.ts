import { route } from "@/server/http";
import { listConfigurationVersions } from "@/server/services/configuration";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ versions: await listConfigurationVersions(id) }));
