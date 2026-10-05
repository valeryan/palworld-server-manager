import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { logoutRemote } from "@/server/services/remote-access";

export const POST = route(async (request) => {
  await logoutRemote(request); const response = NextResponse.json({ ok: true });
  response.cookies.set("psm_remote", "", { httpOnly: true, path: "/", maxAge: 0 }); return response;
}, { admin: false });
