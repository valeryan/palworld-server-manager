import { publicWorld, route } from "@/server/http";
import { patchWorldRegistration } from "@/server/services/configuration";
import { installationHealth } from "@/server/services/installation";
import { requireWorld, unregisterWorld } from "@/server/services/worlds";

export const GET = route<{ id: string }>(async (_request, { id }) => {
  const world = await requireWorld(id);
  return { world: { ...publicWorld(world), installation: await installationHealth(world) } };
});

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const configuration = await patchWorldRegistration(id, await request.json());
  return { world: publicWorld(await requireWorld(id)), configuration };
});

export const DELETE = route<{ id: string }>(async (_request, { id }) => { await unregisterWorld(id); });
