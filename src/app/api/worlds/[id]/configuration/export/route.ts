import AdmZip from "adm-zip";
import { errorResponse, requireAdmin } from "@/server/http";
import { readConfiguration } from "@/server/services/configuration";
import { getWorld } from "@/server/services/worlds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id } = await context.params; const world = await getWorld(id); if (!world) throw new Error("World not found.");
    const configuration = await readConfiguration(id); if (!configuration.content) throw new Error("PalWorldSettings.ini is not available.");
    const zip = new AdmZip();
    zip.addFile("PalWorldSettings.ini", Buffer.from(configuration.content, "utf8"));
    zip.addFile("psm-next-manifest.json", Buffer.from(`${JSON.stringify({ format: "psm-next/configuration", version: 1, exportedAt: new Date().toISOString(), sourceWorldId: id, sourceWorldName: world.displayName }, null, 2)}\n`, "utf8"));
    return new Response(new Uint8Array(zip.toBuffer()), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="palworld-settings-${id}.zip"`, "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
