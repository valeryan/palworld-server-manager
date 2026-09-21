import AdmZip from "adm-zip";
import { z } from "zod";
import { errorResponse, requireAdmin } from "@/server/http";
import { saveConfiguration } from "@/server/services/configuration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { zipBase64 } = z.object({ zipBase64: z.string().min(1).max(7_000_000) }).parse(await request.json());
    const archive = Buffer.from(zipBase64, "base64"); if (archive.byteLength > 5_000_000) throw new Error("Configuration archives must be smaller than 5 MB.");
    const zip = new AdmZip(archive); const entries = zip.getEntries();
    if (entries.some((entry) => entry.entryName.includes("..") || entry.entryName.startsWith("/") || entry.isDirectory)) throw new Error("Configuration archive contains unsafe paths.");
    const settings = entries.find((entry) => entry.entryName === "PalWorldSettings.ini"); if (!settings) throw new Error("Configuration archive is missing PalWorldSettings.ini.");
    const content = settings.getData().toString("utf8"); const result = await saveConfiguration((await context.params).id, content);
    return Response.json({ ok: true, result });
  } catch (error) { return errorResponse(error); }
}
