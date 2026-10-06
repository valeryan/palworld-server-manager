import "server-only";
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createRemoteCodeSchema, remoteAccessSettingsSchema, remoteLoginSchema, type RemotePermission } from "@/contracts/remote-access";
import { database } from "@/server/db";
import { readAppSetting, writeAppSetting } from "@/server/db/app-settings";
import { remoteAccessCodes, remoteAudit, remoteSessions } from "@/server/db/schema";
import { ForbiddenError, HttpError, UnauthorizedError } from "@/server/errors";
import { paths } from "@/server/paths";
import { requireWorld } from "./worlds";

const SETTINGS_KEY = "remote-access-v1";
const SESSION_MS = 30 * 24 * 60 * 60 * 1_000;
const LOCKOUT_MS = 60_000;
const MAX_TRACKED_CLIENTS = 1_000;
const deriveKey = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;

// Failed sign-in attempts per client address plus a global "*" bucket. The address comes from the
// forwarded-for header the Node server fills in from the socket, so a client that sets the header
// itself can choose its bucket; the global bucket still bounds the total rate. Entries expire with
// their lockout so the map cannot grow without limit.
type Attempts = { failures: number; lockedUntil: number; seenAt: number };
const attempts = new Map<string, Attempts>();
function pruneAttempts(now: number) {
  for (const [key, entry] of attempts) if (entry.lockedUntil < now && now - entry.seenAt > LOCKOUT_MS) attempts.delete(key);
  if (attempts.size > MAX_TRACKED_CLIENTS) for (const key of [...attempts.keys()].slice(0, attempts.size - MAX_TRACKED_CLIENTS)) attempts.delete(key);
}
function recordLoginFailure(key: string, limit: number, now: number) {
  const current = attempts.get(key); const failures = (current?.failures ?? 0) + 1;
  attempts.set(key, failures >= limit ? { failures: 0, lockedUntil: now + LOCKOUT_MS, seenAt: now } : { failures, lockedUntil: 0, seenAt: now });
}

export class RemoteAccessError extends HttpError { constructor(message: string, status: 401 | 403 | 429) { super(message, status); } }

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
async function hashCode(code: string, salt = randomBytes(16).toString("hex")): Promise<string> { return `${salt}:${(await deriveKey(code, salt, 32)).toString("hex")}`; }
async function verifyCode(code: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const actual = await deriveKey(code, salt, 32); const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// The session cookie, decoded; a malformed value is treated as absent rather than as a server fault.
function sessionToken(request: Request): string | null {
  const raw = request.headers.get("cookie")?.match(/(?:^|;\s*)psm_remote=([^;]+)/)?.[1];
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
}
export function requestIp(request: Request): string { return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"; }

export function getRemoteAccessSettings() {
  return readAppSetting(SETTINGS_KEY, (value) => remoteAccessSettingsSchema.safeParse(value).data, { enabled: false });
}

export async function setRemoteAccessEnabled(enabled: boolean) {
  const value = remoteAccessSettingsSchema.parse({ enabled });
  await writeAppSetting(SETTINGS_KEY, value);
  writeFileSync(path.join(paths.data(), "remote-access.json"), JSON.stringify(value), { mode: 0o600 });
  if (!enabled) await database().update(remoteSessions).set({ revokedAt: Date.now() }).where(isNull(remoteSessions.revokedAt));
  return value;
}

export async function createRemoteCode(raw: unknown) {
  const input = createRemoteCodeSchema.parse(raw);
  if (input.scope === "world") await requireWorld(input.worldId!);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0"); const now = Date.now(); const id = randomUUID();
  const worldId = input.scope === "world" ? input.worldId! : null;
  await database().insert(remoteAccessCodes).values({ id, codeHash: await hashCode(code), codeHint: code.slice(-2), label: input.label, scope: input.scope, worldId, permissions: input.permissions, enabled: true, createdAt: now });
  return { id, code, codeHint: code.slice(-2), label: input.label, scope: input.scope, worldId, permissions: input.permissions, enabled: true, createdAt: now, lastUsedAt: null };
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
  const { code } = remoteLoginSchema.parse(raw); const ip = requestIp(request); const now = Date.now();
  pruneAttempts(now);
  const locked = [attempts.get(ip), attempts.get("*")].find((entry) => entry && entry.lockedUntil > now);
  if (locked) throw new RemoteAccessError(`Too many attempts. Try again in ${Math.ceil((locked.lockedUntil - now) / 1_000)} seconds.`, 429);
  if (!(await getRemoteAccessSettings()).enabled) throw new ForbiddenError("Remote access is disabled.");
  const candidates = await database().select().from(remoteAccessCodes).where(eq(remoteAccessCodes.enabled, true));
  let match: typeof candidates[number] | undefined;
  for (const candidate of candidates) if (await verifyCode(code, candidate.codeHash)) { match = candidate; break; }
  if (!match) { recordLoginFailure(ip, 5, now); recordLoginFailure("*", 25, now); throw new UnauthorizedError("That access code is not valid."); }
  attempts.delete(ip); attempts.delete("*"); const token = randomBytes(32).toString("base64url");
  await database().insert(remoteSessions).values({ id: randomUUID(), tokenHash: hashToken(token), codeId: match.id, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_MS, ipAddress: ip, userAgent: request.headers.get("user-agent") });
  await database().update(remoteAccessCodes).set({ lastUsedAt: now }).where(eq(remoteAccessCodes.id, match.id));
  await recordRemoteAudit(request, match, "session.login", null, "Remote session signed in");
  return { token, session: { label: match.label, scope: match.scope, worldId: match.worldId, permissions: match.permissions } };
}

export type RemotePrincipal = { sessionId: string; codeId: string; label: string; scope: "all" | "world"; worldId: string | null; permissions: string[] };
export async function authorizeRemote(request: Request, permission: RemotePermission, worldId?: string): Promise<RemotePrincipal> {
  if (!(await getRemoteAccessSettings()).enabled) throw new ForbiddenError("Remote access is disabled.");
  const token = sessionToken(request); if (!token) throw new UnauthorizedError("Remote sign-in required.");
  const now = Date.now();
  const rows = await database().select({ session: remoteSessions, code: remoteAccessCodes }).from(remoteSessions).innerJoin(remoteAccessCodes, eq(remoteSessions.codeId, remoteAccessCodes.id)).where(and(eq(remoteSessions.tokenHash, hashToken(token)), isNull(remoteSessions.revokedAt), gt(remoteSessions.expiresAt, now), eq(remoteAccessCodes.enabled, true))).limit(1);
  const row = rows[0]; if (!row) throw new UnauthorizedError("Remote session is expired or revoked.");
  if (!row.code.permissions.includes(permission)) { await recordRemoteAudit(request, row.code, "access.denied", worldId ?? null, `Missing ${permission}`); throw new ForbiddenError("This access code does not allow that operation."); }
  if (worldId && row.code.scope === "world" && row.code.worldId !== worldId) { await recordRemoteAudit(request, row.code, "access.denied", worldId, "Outside world scope"); throw new ForbiddenError("This access code does not allow that world."); }
  await database().update(remoteSessions).set({ lastSeenAt: now }).where(eq(remoteSessions.id, row.session.id));
  return { sessionId: row.session.id, codeId: row.code.id, label: row.code.label, scope: row.code.scope, worldId: row.code.worldId, permissions: row.code.permissions };
}

export async function logoutRemote(request: Request) { const token = sessionToken(request); if (token) await database().update(remoteSessions).set({ revokedAt: Date.now() }).where(eq(remoteSessions.tokenHash, hashToken(token))); }
export async function recordRemoteAudit(request: Request, code: { id: string; label: string }, action: string, worldId: string | null, detail?: string) { await database().insert(remoteAudit).values({ codeId: code.id, principalLabel: code.label, action, worldId, detail, ipAddress: requestIp(request), createdAt: Date.now() }); }
export async function auditPrincipal(request: Request, principal: RemotePrincipal, action: string, worldId: string, detail?: string) { await recordRemoteAudit(request, { id: principal.codeId, label: principal.label }, action, worldId, detail); }
