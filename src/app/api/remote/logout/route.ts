import { NextResponse } from "next/server";
import { logoutRemote } from "@/server/services/remote-access";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  await logoutRemote(request); const response = NextResponse.json({ ok: true });
  response.cookies.set("psm_remote", "", { httpOnly: true, path: "/", maxAge: 0 }); return response;
}
