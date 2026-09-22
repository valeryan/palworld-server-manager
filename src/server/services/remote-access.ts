import "server-only";
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createRemoteCodeSchema, remoteAccessSettingsSchema, remoteLoginSchema, type RemotePermission } from "@/contracts/remote-access";
import { database } from "@/server/db";
import { appSettings, remoteAccessCodes, remoteAudit, remoteSessions } from "@/server/db/schema";
import { paths } from "@/server/paths";
import { getWorld } from "./worlds";

const SETTINGS_KEY = "remote-access-v1";
const SESSION_MS = 30 * 24 * 60 * 60 * 1_000;
const attempts = new Map<string, { failures: number; lockedUntil: number }>();
export class RemoteAccessError extends Error { constructor(message: string, readonly status: 401 | 403 | 429) { super(message); } }
export function remoteAccessErrorResponse(error: unknown): Response | null { return error instanceof RemoteAccessError ? Response.json({ ok: false, error: error.message }, { status: error.status }) : null; }

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function hashCode(code: string, salt = randomBytes(16).toString("hex")): string { return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`; }
function verifyCode(code: string, encoded: string): boolean {
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(code, salt, 32); const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function cookie(request: Request, name: string): string | null { return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? null; }
export function requestIp(request: Request): string { return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"; }
function recordLoginFailure(key: string, limit: number) { const current = attempts.get(key); const failures = (current?.failures ?? 0) + 1; attempts.set(key, failures >= limit ? { failures: 0, lockedUntil: Date.now() + 60_000 } : { failures, lockedUntil: 0 }); }

export async function getRemoteAccessSettings() {
  const [row] = await database().select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const parsed = remoteAccessSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : { enabled: false };
}

export async function setRemoteAccessEnabled(enabled: boolean) {
  const value = remoteAccessSettingsSchema.parse({ enabled });
  await database().insert(appSettings).values({ key: SETTINGS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  writeFileSync(path.join(paths.data(), "remote-access.json"), JSON.stringify(value), { mode: 0o600 });
  if (!enabled) await database().update(remoteSessions).set({ revokedAt: Date.now() }).where(isNull(remoteSessions.revokedAt));
  return value;
}

export async function createRemoteCode(raw: unknown) {
  const input = createRemoteCodeSchema.parse(raw);
  if (input.scope === "world" && !(await getWorld(input.worldId!))) throw new Error("World not found.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0"); const now = Date.now(); const id = randomUUID();
  await database().insert(remoteAccessCodes).values({ id, codeHash: hashCode(code), codeHint: code.slice(-2), label: input.label, scope: input.scope, worldId: input.scope === "world" ? input.worldId! : null, permissions: input.permissions, enabled: true, createdAt: now });
  return { id, code, codeHint: code.slice(-2), label: input.label, scope: input.scope, worldId: input.scope === "world" ? input.worldId! : null, permissions: input.permissions, enabled: true, createdAt: now, lastUsedAt: null };
}

export async function listRemoteAccess() {
  const [codes, sessions, audit] = await Promise.all([
    database().select({ id: remoteAccessCodes.id, codeHint: remoteAccessCodes.codeHint, label: remoteAccessCodes.label, scope: remoteAccessCodes.scope, worldId: remoteAccessCodes.worldId, permissions: remoteAccessCodes.permissions, enabled: remoteAccessCodes.enabled, createdAt: remoteAccessCodes.createdAt, lastUsedAt: remoteAccessCodes.lastUsedAt }).from(remoteAccessCodes).orderBy(desc(remoteAccessCodes.createdAt)),
    database().select({ id: remoteSessions.id, codeId: remoteSessions.codeId, createdAt: remoteSessions.createdAt, lastSeenAt: remoteSessions.lastSeenAt, expiresAt: remoteSessions.expiresAt, revokedAt: remoteSessions.revokedAt, ipAddress: remoteSessions.ipAddress, userAgent: remoteSessions.userAgent }).from(remoteSessions).orderBy(desc(remoteSessions.lastSeenAt)),
    database().select().from(remoteAudit).orderBy(desc(remoteAudit.createdAt)).limit(100),
  ]);
  return { settings: await getRemoteAccessSettings(), codes, sessions, audit };
}

export async function updateRemoteCode(id: string, enabled: boolean) {
  await database().update(remoteAccessCodes).set({ enabled }).where(eq(remoteAccessCodes.id, id));
  if (!enabled) await revokeRemoteSessions(id);
}
export async function deleteRemoteCode(id: string) { await database().delete(remoteAccessCodes).where(eq(remoteAccessCodes.id, id)); }
export async function revokeRemoteSessions(codeId?: string) {
  const condition = codeId ? and(eq(remoteSessions.codeId, codeId), isNull(remoteSessions.revokedAt)) : isNull(remoteSessions.revokedAt);
  await database().update(remoteSessions).set({ revokedAt: Date.now() }).where(condition);
}

export async function loginRemote(request: Request, raw: unknown) {
  const { code } = remoteLoginSchema.parse(raw); const ip = requestIp(request); const current = [attempts.get(ip), attempts.get("*")].find((entry) => entry?.lockedUntil && entry.lockedUntil > Date.now());
  if (current?.lockedUntil && current.lockedUntil > Date.now()) throw new RemoteAccessError(`Too many attempts. Try again in ${Math.ceil((current.lockedUntil - Date.now()) / 1_000)} seconds.`, 429);
  if (!(await getRemoteAccessSettings()).enabled) throw new RemoteAccessError("Remote access is disabled.", 403);
  const candidates = await database().select().from(remoteAccessCodes).where(eq(remoteAccessCodes.enabled, true));
  const match = candidates.find((candidate) => verifyCode(code, candidate.codeHash));
  if (!match) { recordLoginFailure(ip, 5); recordLoginFailure("*", 25); throw new RemoteAccessError("That access code is not valid.", 401); }
  attempts.delete(ip); attempts.delete("*"); const token = randomBytes(32).toString("base64url"); const now = Date.now();
  await database().insert(remoteSessions).values({ id: randomUUID(), tokenHash: hashToken(token), codeId: match.id, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_MS, ipAddress: ip, userAgent: request.headers.get("user-agent") });
  await database().update(remoteAccessCodes).set({ lastUsedAt: now }).where(eq(remoteAccessCodes.id, match.id));
  await recordRemoteAudit(request, match, "session.login", null, "Remote session signed in");
  return { token, session: { label: match.label, scope: match.scope, worldId: match.worldId, permissions: match.permissions } };
}

export type RemotePrincipal = { sessionId: string; codeId: string; label: string; scope: "all" | "world"; worldId: string | null; permissions: string[] };
export async function authorizeRemote(request: Request, permission: RemotePermission, worldId?: string): Promise<RemotePrincipal> {
  if (!(await getRemoteAccessSettings()).enabled) throw new RemoteAccessError("Remote access is disabled.", 403);
  const token = cookie(request, "psm_remote"); if (!token) throw new RemoteAccessError("Remote sign-in required.", 401);
  const now = Date.now();
  const rows = await database().select({ session: remoteSessions, code: remoteAccessCodes }).from(remoteSessions).innerJoin(remoteAccessCodes, eq(remoteSessions.codeId, remoteAccessCodes.id)).where(and(eq(remoteSessions.tokenHash, hashToken(decodeURIComponent(token))), isNull(remoteSessions.revokedAt), gt(remoteSessions.expiresAt, now), eq(remoteAccessCodes.enabled, true))).limit(1);
  const row = rows[0]; if (!row) throw new RemoteAccessError("Remote session is expired or revoked.", 401);
  if (!row.code.permissions.includes(permission)) { await recordRemoteAudit(request, row.code, "access.denied", worldId ?? null, `Missing ${permission}`); throw new RemoteAccessError("This access code does not allow that operation.", 403); }
  if (worldId && row.code.scope === "world" && row.code.worldId !== worldId) { await recordRemoteAudit(request, row.code, "access.denied", worldId, "Outside world scope"); throw new RemoteAccessError("This access code does not allow that world.", 403); }
  await database().update(remoteSessions).set({ lastSeenAt: now }).where(eq(remoteSessions.id, row.session.id));
  return { sessionId: row.session.id, codeId: row.code.id, label: row.code.label, scope: row.code.scope, worldId: row.code.worldId, permissions: row.code.permissions };
}

export async function logoutRemote(request: Request) { const token = cookie(request, "psm_remote"); if (token) await database().update(remoteSessions).set({ revokedAt: Date.now() }).where(eq(remoteSessions.tokenHash, hashToken(decodeURIComponent(token)))); }
export async function recordRemoteAudit(request: Request, code: { id: string; label: string }, action: string, worldId: string | null, detail?: string) { await database().insert(remoteAudit).values({ codeId: code.id, principalLabel: code.label, action, worldId, detail, ipAddress: requestIp(request), createdAt: Date.now() }); }
export async function auditPrincipal(request: Request, principal: RemotePrincipal, action: string, worldId: string, detail?: string) { await database().insert(remoteAudit).values({ codeId: principal.codeId, principalLabel: principal.label, action, worldId, detail, ipAddress: requestIp(request), createdAt: Date.now() }); }
