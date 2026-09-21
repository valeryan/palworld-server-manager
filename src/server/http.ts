import "server-only";
import { ZodError } from "zod";
import type { WorldView } from "@/contracts/world";

export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) return Response.json({ ok: false, error: "Invalid request", issues: error.issues }, { status: 400 });
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404 : /already|overlap|port|stop the|start the|enable the|disabled for|invalid|missing|cannot|must|unknown structured|select between|only queued/i.test(message) ? 409 : 500;
  return Response.json({ ok: false, error: message }, { status });
}

export function requireAdmin(request: Request): Response | null {
  const expected = process.env.PSM_ADMIN_TOKEN;
  if (!expected) return process.env.NODE_ENV === "development" ? null : Response.json({ ok: false, error: "Desktop authentication is unavailable." }, { status: 503 });
  const cookie = request.headers.get("cookie") ?? "";
  const actual = cookie.match(/(?:^|;\s*)psm_admin=([^;]+)/)?.[1];
  return actual === expected ? null : Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export function publicWorld(world: WorldView): Omit<WorldView, "adminPassword" | "serverPassword" | "env"> {
  const safe: Partial<WorldView> = { ...world };
  delete safe.adminPassword; delete safe.serverPassword; delete safe.env;
  return safe as Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
}
