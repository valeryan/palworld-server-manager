import "server-only";
import type { WorldView } from "@/contracts/world";
import { readConfigurationCredentials } from "./configuration";

async function request(world: WorldView, method: string, endpoint: string, body?: unknown, timeoutMs = 5_000): Promise<unknown> {
  if (!world.restApiEnabled) throw new Error("REST API is disabled for this world.");
  const { adminPassword } = await readConfigurationCredentials(world.id);
  if (!adminPassword) throw new Error("Set an administrator password before using the Palworld REST API.");
  const response = await fetch(`http://127.0.0.1:${world.restApiPort}/v1/api/${endpoint}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Basic ${Buffer.from(`admin:${adminPassword}`).toString("base64")}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
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
  settings: (world: WorldView) => request(world, "GET", "settings"),
  save: (world: WorldView) => request(world, "POST", "save"),
  announce: (world: WorldView, message: string) => request(world, "POST", "announce", { message }),
  kick: (world: WorldView, userId: string, message = "You have been kicked by an administrator.") => request(world, "POST", "kick", { userid: userId, message }),
  ban: (world: WorldView, userId: string, message = "You have been banned by an administrator.") => request(world, "POST", "ban", { userid: userId, message }),
  unban: (world: WorldView, userId: string) => request(world, "POST", "unban", { userid: userId }),
  shutdown: (world: WorldView, waitSeconds = 15, message = "Server shutting down.") => request(world, "POST", "shutdown", { waittime: waitSeconds, message }),
};
