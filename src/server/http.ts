import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import type { WorldView } from "@/contracts/world";
import { HttpError } from "@/server/errors";
import { worldIsLocked } from "@/server/services/jobs";

// Legacy mapping for services that still throw a plain Error. New code throws an HttpError subclass.
const CONFLICT_MESSAGE = /already|overlap|port|revision|changed since|stop the|start the|enable the|disabled for|invalid|missing|cannot|must|unknown structured|select between|only queued/i;

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ ok: false, error: "Invalid request", issues: error.issues }, { status: 400 });
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404 : CONFLICT_MESSAGE.test(message) ? 409 : 500;
  return Response.json({ ok: false, error: message }, { status });
}

function sameToken(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireAdmin(request: Request): Response | null {
  const expected = process.env.PSM_ADMIN_TOKEN;
  if (!expected) { if (process.env.NODE_ENV !== "development") return Response.json({ ok: false, error: "Desktop authentication is unavailable." }, { status: 503 }); }
  else if (!sameToken(request.headers.get("cookie")?.match(/(?:^|;\s*)psm_admin=([^;]+)/)?.[1], expected)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const mutation = !["GET", "HEAD"].includes(request.method); const pathname = new URL(request.url).pathname;
  if (mutation && globalThis.__psmDraining && !/\/runtime\/drain$|\/cancel$/.test(pathname)) return Response.json({ ok: false, error: "The manager is quitting; new changes are disabled." }, { status: 503 });
  const worldMutation = mutation && pathname.match(/^\/api\/worlds\/([^/]+)(?!.*\/actions$)/);
  if (worldMutation && worldIsLocked(worldMutation[1]!)) return Response.json({ ok: false, error: "Another operation is already running for this world." }, { status: 409 });
  return null;
}

export function publicWorld(world: WorldView): Omit<WorldView, "adminPassword" | "serverPassword" | "env"> {
  const safe: Partial<WorldView> = { ...world };
  delete safe.adminPassword; delete safe.serverPassword; delete safe.env;
  return safe as Omit<WorldView, "adminPassword" | "serverPassword" | "env">;
}
