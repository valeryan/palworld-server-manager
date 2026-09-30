import { errorResponse, requireAdmin } from "@/server/http";
import { importLuaArchive, MAX_LUA_ARCHIVE_BYTES } from "@/server/mods/lua-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The archive is the raw request body; its original name comes in x-file-name.
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_LUA_ARCHIVE_BYTES) throw new Error("The archive is larger than 100 MiB.");
    const fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "mod.zip");
    const artifact = await importLuaArchive(Buffer.from(await request.arrayBuffer()), fileName);
    return Response.json({ ok: true, mod: { id: artifact.id, name: artifact.name } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
