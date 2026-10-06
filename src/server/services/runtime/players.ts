import "server-only";

// Who is online per world, as last reported by the server's REST API.
export type Player = { key: string; name: string; userId: string | null };
declare global { var __psmPresence: Map<string, Map<string, Player>> | undefined; }
export const presence = () => (globalThis.__psmPresence ??= new Map<string, Map<string, Player>>());

export function playersFrom(value: unknown): Player[] {
  const list = value && typeof value === "object" && Array.isArray((value as { players?: unknown }).players) ? (value as { players: Array<Record<string, unknown>> }).players : [];
  return list.map((item, index) => {
    const userId = String(item.userId ?? item.userid ?? item.accountName ?? "").trim() || null;
    const name = String(item.name ?? item.playername ?? item.playerName ?? userId ?? `Player ${index + 1}`);
    return { key: userId ?? name.toLocaleLowerCase(), name, userId };
  });
}
