import { errorResponse, requireAdmin } from "@/server/http";
import { importLuaArchive, MAX_LUA_ARCHIVE_BYTES } from "@/server/mods/lua-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads the body up to the limit, whatever Content-Length says (a chunked upload has none).
async function readLimited(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("The archive is larger than 100 MiB.");
  const reader = request.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error("The archive is larger than 100 MiB."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// The archive is the raw request body; its original name comes in x-file-name.
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "mod.zip");
    const artifact = await importLuaArchive(await readLimited(request, MAX_LUA_ARCHIVE_BYTES), fileName);
    return Response.json({ ok: true, mod: { id: artifact.id, name: artifact.name } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
