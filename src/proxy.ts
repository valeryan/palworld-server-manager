import { NextResponse, type NextRequest } from "next/server";

function isDesktopAdmin(request: NextRequest): boolean {
  const expected = process.env.PSM_ADMIN_TOKEN;
  return !expected ? process.env.NODE_ENV === "development" : request.cookies.get("psm_admin")?.value === expected;
}

export function proxy(request: NextRequest) {
  if (isDesktopAdmin(request)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Desktop authentication required." }, { status: 401 });
  return NextResponse.redirect(new URL("/remote", request.url));
}

export const config = { matcher: ["/", "/settings/:path*", "/operations/:path*", "/mods/:path*", "/worlds/:path*", "/api/((?!(?:remote|i18n/current)(?:/|$)).*)"] };
