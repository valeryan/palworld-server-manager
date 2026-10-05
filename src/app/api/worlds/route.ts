import { readdir } from "node:fs/promises";
import { canonicalInstallDir } from "@/server/services/worlds";
import { installationHealth } from "@/server/services/installation";
import { adoptWorld, createWorld, listWorlds } from "@/server/services/worlds";
import { errorResponse, publicWorld, requireAdmin } from "@/server/http";

export async function GET() {
  try { return Response.json({ ok: true, worlds: await Promise.all((await listWorlds()).map(async (world) => ({ ...publicWorld(world), installation: await installationHealth(world) }))) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const body = await request.json(); if (new URL(request.url).searchParams.get("mode") !== "adopt" && typeof body.installDir === "string") { const directory = await canonicalInstallDir(body.installDir); const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; }); if (entries.length) throw new Error("A new installation must use an empty directory. Use Adopt for an existing server."); } const world = new URL(request.url).searchParams.get("mode") === "adopt" ? await adoptWorld(body) : await createWorld(body); return Response.json({ ok: true, world: publicWorld(world) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
