import { administrationRequestSchema } from "@/contracts/world-administration";
import { route } from "@/server/http";
import { readAdministration, saveAdministration } from "@/server/services/configuration";

export const GET = route<{ id: string }>((_request, { id }) => readAdministration(id));
export const PUT = route<{ id: string }>(async (request, { id }) => saveAdministration(id, administrationRequestSchema.parse(await request.json())));
