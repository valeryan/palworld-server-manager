import { z } from "zod";
import { validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { errorResponse, requireAdmin } from "@/server/http";
import { readConfigurationOptions, saveConfigurationOptions } from "@/server/services/configuration";
import { getWorld, updateWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const port = z.coerce.number().int().min(1).max(65535);
const managedSchema = z.object({
  adminPassword: z.string().max(256).optional(),
  serverPassword: z.string().max(256).optional(),
  restApiEnabled: z.boolean().optional(),
  restApiPort: port.optional(),
  rconEnabled: z.boolean().optional(),
  rconPort: port.optional(),
}).strict();
const requestSchema = z.object({ changes: z.record(z.string(), z.unknown()).default({}), managed: managedSchema.default({}) }).strict();

export async function GET(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const world = await getWorld(id); if (!world) throw new Error("World not found.");
    return Response.json({
      ok: true,
      configuration: await readConfigurationOptions(id),
      admin: {
        adminPasswordSet: Boolean(world.adminPassword), serverPasswordSet: Boolean(world.serverPassword),
        restApiEnabled: world.restApiEnabled, restApiPort: world.restApiPort,
        rconEnabled: world.rconEnabled, rconPort: world.rconPort,
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    const encoded = Object.keys(input.changes).length ? validateAndEncodeSettingChanges(input.changes) : {};
    const managedKeys = Object.keys(input.managed) as Array<keyof typeof input.managed>;
    const world = managedKeys.length ? await updateWorld(id, input.managed) : await getWorld(id);
    if (!world) throw new Error("World not found.");
    const synchronized: Record<string, string> = {
      AdminPassword: JSON.stringify(world.adminPassword), ServerPassword: JSON.stringify(world.serverPassword),
      RESTAPIEnabled: world.restApiEnabled ? "True" : "False", RESTAPIPort: String(world.restApiPort),
      RCONEnabled: world.rconEnabled ? "True" : "False", RCONPort: String(world.rconPort),
    };
    const changes = { ...encoded, ...synchronized };
    if (!Object.keys(changes).length) throw new Error("No configuration changes were provided.");
    const result = await saveConfigurationOptions(id, changes);
    return Response.json({
      ok: true, result,
      credentials: { adminPasswordSet: Boolean(world.adminPassword), serverPasswordSet: Boolean(world.serverPassword) },
    });
  } catch (error) { return errorResponse(error); }
}
