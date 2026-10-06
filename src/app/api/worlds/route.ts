import { publicWorld, route } from "@/server/http";
import { installationHealth } from "@/server/services/installation";
import { registerWorld } from "@/server/services/installation";
import { listWorlds } from "@/server/services/worlds";

export const GET = route(async () => ({ worlds: await Promise.all((await listWorlds()).map(async (world) => ({ ...publicWorld(world), installation: await installationHealth(world) }))) }));

export const POST = route(async (request) => {
  const mode = new URL(request.url).searchParams.get("mode") === "adopt" ? "adopt" : "install";
  return { world: publicWorld(await registerWorld(await request.json(), mode)) };
}, { status: 201 });
