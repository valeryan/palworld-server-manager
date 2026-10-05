import { hostCapabilities } from "@/server/host";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ ok: true, host: hostCapabilities() }); }
