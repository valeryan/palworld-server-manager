import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { route } from "@/server/http";
import { getBackup } from "@/server/services/backups";

export const GET = route<{ id: string; backupId: string }>(async (_request, { id, backupId }) => {
  const record = await getBackup(id, backupId);
  const info = await stat(record.filePath);
  const fileName = path.basename(record.filePath).replaceAll(/["\r\n]/g, "_");
  const body = Readable.toWeb(createReadStream(record.filePath)) as ReadableStream;
  return new Response(body, { headers: { "content-type": "application/zip", "content-length": String(info.size), "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "no-store" } });
});
