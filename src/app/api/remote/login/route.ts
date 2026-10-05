import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { loginRemote } from "@/server/services/remote-access";

export async function POST(request: Request) {
  try {
    const result = await loginRemote(request, await request.json());
    const response = NextResponse.json({ ok: true, session: result.session });
    response.cookies.set("psm_remote", result.token, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 30 * 24 * 60 * 60 });
    return response;
  } catch (error) { return errorResponse(error); }
}
