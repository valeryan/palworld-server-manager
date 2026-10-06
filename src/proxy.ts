import { NextResponse, type NextRequest } from "next/server";

function isDesktopAdmin(request: NextRequest): boolean {
  const expected = process.env.PSM_ADMIN_TOKEN;
  return !expected ? process.env.NODE_ENV === "development" : request.cookies.get("psm_admin")?.value === expected;
}

export function proxy(request: NextRequest) {
  if (isDesktopAdmin(request)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Desktop authentication required." }, { status: 401 });
  return new NextResponse("Desktop authentication required.", { status: 401 });
}

// The current language pack stays public so the UI can load its strings before authentication.
export const config = { matcher: ["/", "/settings/:path*", "/operations/:path*", "/mods/:path*", "/worlds/:path*", "/api/((?!i18n/current(?:/|$)).*)"] };
