export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The UI labels Windows worlds as running under Wine only when the manager's host is not Windows.
export async function GET() { return Response.json({ ok: true, host: { platform: process.platform } }); }
