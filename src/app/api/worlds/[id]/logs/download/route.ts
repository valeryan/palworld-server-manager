import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { ConflictError } from "@/server/errors";
import { route } from "@/server/http";
import { worldLogFile } from "@/server/services/observability";

export const GET = route<{ id: string }>(async (request, { id }) => {
  const selected = new URL(request.url).searchParams.get("file");
  if (!selected) throw new ConflictError("Select a server log to download.");
  const { filePath, fileName, info } = await worldLogFile(id, selected);
  const safeName = fileName.replaceAll(/["\r\n]/g, "_");
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "content-length": String(info.size), "content-disposition": `attachment; filename="${safeName}"`, "cache-control": "no-store" } });
});
