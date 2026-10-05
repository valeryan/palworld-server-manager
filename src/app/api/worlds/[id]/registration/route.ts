import { route } from "@/server/http";
import { exportWorldRegistration, requireWorld } from "@/server/services/worlds";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ registration: exportWorldRegistration(await requireWorld(id)) }));
