import "server-only";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import type { PublicWorldView, WorldView } from "@/contracts/world";
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

export function publicWorld(world: WorldView): PublicWorldView {
  const safe: Partial<WorldView> = { ...world };
  delete safe.adminPassword; delete safe.serverPassword; delete safe.env;
  return safe as PublicWorldView;
}

type RouteParams = Record<string, string>;
type RouteResult = Response | Record<string, unknown> | void;
type RouteContext<P> = { params: Promise<P> };
type RouteOptions = {
  /** Require the desktop admin cookie (default). Remote and public routes pass false and authenticate themselves. */
  admin?: boolean;
  /** Status for a successful JSON result; 200 by default, 201/202 for creations and accepted jobs. */
  status?: number;
};

/**
 * Wraps a route handler with the shared concerns of every API route: admin authentication, awaiting
 * the dynamic params, the `{ ok: true, ... }` success envelope and HTTP-status-aware error mapping.
 * A handler may return a Response of its own (files, streams, cookies) to bypass the envelope.
 */
export function route<P extends RouteParams = Record<string, never>>(handler: (request: Request, params: P) => Promise<RouteResult> | RouteResult, options: RouteOptions = {}) {
  return async (request: Request, context?: RouteContext<P>): Promise<Response> => {
    try {
      if (options.admin !== false) { const denied = requireAdmin(request); if (denied) return denied; }
      const result = await handler(request, context ? await context.params : ({} as P));
      if (result instanceof Response) return result;
      return Response.json({ ok: true, ...(result ?? {}) }, { status: options.status ?? 200 });
    } catch (error) { return errorResponse(error); }
  };
}
