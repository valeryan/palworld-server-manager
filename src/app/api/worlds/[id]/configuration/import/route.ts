import AdmZip from "adm-zip";
import { z } from "zod";
import { ConflictError } from "@/server/errors";
import { route } from "@/server/http";
import { safeEntries } from "@/server/services/archive";
import { saveConfiguration } from "@/server/services/configuration";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { zipBase64, baseRevision } = z.object({ zipBase64: z.string().min(1).max(7_000_000), baseRevision: z.number().int().nonnegative() }).parse(await request.json());
  const archive = Buffer.from(zipBase64, "base64"); if (archive.byteLength > 5_000_000) throw new ConflictError("Configuration archives must be smaller than 5 MB.");
  const zip = new AdmZip(archive); const entries = zip.getEntries();
  if (!safeEntries(zip) || entries.some((entry) => entry.isDirectory || entry.header.size > 2_000_000)) throw new ConflictError("Configuration archive contains unsafe paths.");
  const settings = entries.find((entry) => entry.entryName === "PalWorldSettings.ini"); if (!settings) throw new ConflictError("Configuration archive is missing PalWorldSettings.ini.");
  return { result: await saveConfiguration(id, settings.getData().toString("utf8"), baseRevision) };
});
