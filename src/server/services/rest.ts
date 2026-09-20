import "server-only";
import type { WorldView } from "@/contracts/world";

async function request(world: WorldView, method: string, endpoint: string, body?: unknown, timeoutMs = 5_000): Promise<unknown> {
  if (!world.restApiEnabled) throw new Error("REST API is disabled for this world.");
  const response = await fetch(`http://127.0.0.1:${world.restApiPort}/v1/api/${endpoint}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Basic ${Buffer.from(`admin:${world.adminPassword}`).toString("base64")}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Palworld REST ${response.status}: ${responseText || response.statusText}`);
  try { return responseText ? JSON.parse(responseText) : {}; } catch { return { raw: responseText }; }
}

export const palworldRest = {
  info: (world: WorldView) => request(world, "GET", "info"),
  players: (world: WorldView) => request(world, "GET", "players"),
  metrics: (world: WorldView) => request(world, "GET", "metrics"),
  save: (world: WorldView) => request(world, "POST", "save"),
  shutdown: (world: WorldView, waitSeconds = 15, message = "Server shutting down.") => request(world, "POST", "shutdown", { waittime: waitSeconds, message }),
};
