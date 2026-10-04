import { errorResponse, publicWorld, requireAdmin } from "@/server/http";
import { getWorld, unregisterWorld } from "@/server/services/worlds";
import { advertisedPortState, applyConfigurationOptions, managedConfigurationChanges, managedPublicPortChange, parseConfigurationOptions, readSettingsState, saveDesiredSettings } from "@/server/services/configuration";
import { managedWorldSettingsSchema, parseWorldUpdate } from "@/contracts/world";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { const { id } = await context.params; const world = await getWorld(id); return world ? Response.json({ ok: true, world: publicWorld(world) }) : Response.json({ ok: false, error: "World not found." }, { status: 404 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; const raw: unknown = await request.json(); if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid request."); const input = raw as Record<string, unknown>; const baseRevision = Number(input.baseRevision); if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error("A valid baseRevision is required."); const patch = parseWorldUpdate(input); const current = await readSettingsState(id); const { adminPassword, serverPassword, ...managerPatch } = patch; const manager = managedWorldSettingsSchema.parse({ ...current.desiredManager, ...managerPatch }); const inheritedPublicPort = managedPublicPortChange(advertisedPortState(parseConfigurationOptions(current.desiredContent).PublicPort, current.desiredManager.gamePort), current.desiredManager.gamePort, manager.gamePort, undefined, false); const optionChanges = { ...managedConfigurationChanges(manager), ...(inheritedPublicPort === undefined ? {} : { PublicPort: inheritedPublicPort }), ...(adminPassword === undefined ? {} : { AdminPassword: JSON.stringify(adminPassword) }), ...(serverPassword === undefined ? {} : { ServerPassword: JSON.stringify(serverPassword) }) }; const result = await saveDesiredSettings(id, { baseRevision, manager, content: applyConfigurationOptions(current.desiredContent, optionChanges) }); const world = await getWorld(id); if (!world) throw new Error("World not found.");
    return Response.json({ ok: true, world: publicWorld(world), configuration: result }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try { const { id } = await context.params; await unregisterWorld(id); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
