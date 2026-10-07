import "server-only";
import type { Player } from "@/lib/players";

// Who is online per world, as last reported by the server's REST API.
export { playersFrom, type Player } from "@/lib/players";
declare global { var __psmPresence: Map<string, Map<string, Player>> | undefined; }
export const presence = () => (globalThis.__psmPresence ??= new Map<string, Map<string, Player>>());
