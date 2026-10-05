import { route } from "@/server/http";
import { suggestWorldPorts } from "@/server/services/worlds";

export const GET = route(async () => ({ ports: await suggestWorldPorts() }));
