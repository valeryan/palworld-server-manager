import { route } from "@/server/http";
import { authorizeRemote } from "@/server/services/remote-access";

export const GET = route(async (request) => ({ session: await authorizeRemote(request, "world.view") }), { admin: false });
