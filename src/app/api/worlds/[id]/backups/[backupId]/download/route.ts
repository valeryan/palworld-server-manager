import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { errorResponse, requireAdmin } from "@/server/http";
import { getBackup } from "@/server/services/backups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; backupId: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const { id, backupId } = await context.params;
    const record = await getBackup(id, backupId);
    const info = await stat(record.filePath);
    const fileName = path.basename(record.filePath).replaceAll(/["\r\n]/g, "_");
    const body = Readable.toWeb(createReadStream(record.filePath)) as ReadableStream;
    return new Response(body, { headers: { "content-type": "application/zip", "content-length": String(info.size), "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
