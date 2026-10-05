import { hostCapabilities } from "@/server/host";
export async function GET() { return Response.json({ ok: true, host: hostCapabilities() }); }
