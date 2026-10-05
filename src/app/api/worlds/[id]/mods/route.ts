import { route } from "@/server/http";
import { worldModStatus } from "@/server/mods/status";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ mods: await worldModStatus(id) }));
