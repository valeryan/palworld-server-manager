import { publicWorld, route } from "@/server/http";
import { installationHealth } from "@/server/services/installation";
import { registerWorld } from "@/server/services/installation";
import { adoptRegisteredServer, assertAdoptableInstall } from "@/server/services/lifecycle";
import { canonicalInstallDir, listWorlds } from "@/server/services/worlds";

export const GET = route(async () => ({ worlds: await Promise.all((await listWorlds()).map(async (world) => ({ ...publicWorld(world), installation: await installationHealth(world) }))) }));

// Adopting a folder whose server is already running takes that server over, so it can be
// monitored and stopped; a server a live foreign manager owns is refused before anything is created.
export const POST = route(async (request) => {
  const mode = new URL(request.url).searchParams.get("mode") === "adopt" ? "adopt" : "install";
  const body = await request.json() as { installDir?: unknown };
  if (mode === "adopt" && typeof body.installDir === "string" && body.installDir.trim()) await assertAdoptableInstall(await canonicalInstallDir(body.installDir));
  const world = await registerWorld(body, mode);
  if (mode === "adopt") await adoptRegisteredServer(world);
  return { world: publicWorld(world) };
}, { status: 201 });
