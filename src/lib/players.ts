// A player as the server's REST API reports one, normalized the same way on the server (presence
// polling) and in the browser (the Players tab).
export type Player = { key: string; name: string; userId: string | null; accountName: string | null };

export function playersFrom(value: unknown): Player[] {
  const list = value && typeof value === "object" && Array.isArray((value as { players?: unknown }).players) ? (value as { players: Array<Record<string, unknown>> }).players : [];
  return list.map((item, index) => {
    const userId = String(item.userId ?? item.userid ?? item.accountName ?? "").trim() || null;
    const name = String(item.name ?? item.playername ?? item.playerName ?? userId ?? `Player ${index + 1}`);
    const accountName = String(item.accountName ?? item.accountname ?? "").trim() || null;
    return { key: userId ?? name.toLocaleLowerCase(), name, userId, accountName };
  });
}
