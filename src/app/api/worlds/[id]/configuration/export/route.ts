import AdmZip from "adm-zip";
import { ConflictError } from "@/server/errors";
import { route } from "@/server/http";
import { readConfiguration } from "@/server/services/configuration";
import { requireWorld } from "@/server/services/worlds";

export const GET = route<{ id: string }>(async (_request, { id }) => {
  const world = await requireWorld(id);
  const configuration = await readConfiguration(id); if (!configuration.content) throw new ConflictError("PalWorldSettings.ini is not available.");
  const zip = new AdmZip();
  zip.addFile("PalWorldSettings.ini", Buffer.from(configuration.content, "utf8"));
  zip.addFile("psm-next-manifest.json", Buffer.from(`${JSON.stringify({ format: "psm-next/configuration", version: 1, exportedAt: new Date().toISOString(), sourceWorldId: id, sourceWorldName: world.displayName, desiredRevision: configuration.desiredRevision, appliedRevision: configuration.appliedRevision, pendingApply: configuration.pendingApply }, null, 2)}\n`, "utf8"));
  return new Response(new Uint8Array(zip.toBuffer()), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="palworld-settings-${id}.zip"`, "cache-control": "no-store" } });
});
