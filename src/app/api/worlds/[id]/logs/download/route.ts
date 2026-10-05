import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { errorResponse, requireAdmin } from "@/server/http";
import { worldLogFile } from "@/server/services/observability";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const selected = new URL(request.url).searchParams.get("file");
    if (!selected) throw new Error("Select a server log to download.");
    const { filePath, fileName, info } = await worldLogFile((await context.params).id, selected);
    const safeName = fileName.replaceAll(/["\r\n]/g, "_");
    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "content-length": String(info.size), "content-disposition": `attachment; filename="${safeName}"`, "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
