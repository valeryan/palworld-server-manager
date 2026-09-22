import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { database } from "@/server/db";
import { configVersions, events, worlds } from "@/server/db/schema";
import type { WorldView } from "@/contracts/world";
import { getWorld } from "./worlds";
import { pruneConfigurationVersions } from "./retention";

function configPath(installDir: string, platform: "linux" | "windows") {
  return path.join(installDir, "Pal", "Saved", "Config", platform === "windows" ? "WindowsServer" : "LinuxServer", "PalWorldSettings.ini");
}
function defaultPath(installDir: string) { return path.join(installDir, "DefaultPalWorldSettings.ini"); }
function validate(content: string) {
  if (Buffer.byteLength(content) > 2_000_000) throw new Error("Configuration exceeds the 2 MB safety limit.");
  if (content.includes("\0")) throw new Error("Configuration contains a NUL byte.");
  const match = content.match(/OptionSettings=\((.*)\)/s);
  if (!match) throw new Error("Configuration must contain OptionSettings=(...).");
  let quoted = false; let escaped = false; let depth = 0;
  for (const character of match[1] ?? "") {
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "(") depth += 1;
    else if (!quoted && character === ")") depth -= 1;
    if (depth < 0) throw new Error("OptionSettings contains unbalanced parentheses.");
  }
  if (quoted || depth !== 0) throw new Error("OptionSettings contains unbalanced quotes or parentheses.");
}

function splitOptions(body: string): string[] {
  const parts: string[] = []; let start = 0; let quoted = false; let escaped = false; let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === "(") depth += 1;
    else if (!quoted && character === ")") depth -= 1;
    else if (!quoted && depth === 0 && character === ",") { parts.push(body.slice(start, index)); start = index + 1; }
  }
  parts.push(body.slice(start)); return parts.filter((part) => part.trim());
}

export function parseConfigurationOptions(content: string): Record<string, string> {
  const body = content.match(/OptionSettings=\((.*)\)/s)?.[1]; if (body == null) return {};
  return Object.fromEntries(splitOptions(body).flatMap((part) => { const separator = part.indexOf("="); return separator > 0 ? [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]] : []; }));
}

export function serializeConfigurationOptions(options: Record<string, string>): string {
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${Object.entries(options).map(([key, value]) => `${key}=${value}`).join(",")})\n`;
}

export function applyConfigurationOptions(content: string, changes: Record<string, string>): string {
  const match = content.match(/OptionSettings=\((.*)\)/s); if (!match || match.index == null) throw new Error("Configuration must contain OptionSettings=(...).");
  const tokens = splitOptions(match[1] ?? ""); const positions = new Map(tokens.map((part, index) => [part.slice(0, part.indexOf("=")).trim(), index]));
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid configuration key: ${key}`);
    if (/[\r\n\0]/.test(value) || value.length > 8_192) throw new Error(`Invalid configuration value for ${key}.`);
    const token = `${key}=${value}`; const index = positions.get(key);
    if (index == null) { positions.set(key, tokens.length); tokens.push(token); } else tokens[index] = token;
  }
  const start = match.index + "OptionSettings=(".length; const end = start + (match[1]?.length ?? 0);
  const result = `${content.slice(0, start)}${tokens.join(",")}${content.slice(end)}`; validate(result); return result;
}
async function snapshot(worldId: string, content: string, note: string) {
  await database().insert(configVersions).values({ id: randomUUID(), worldId, fileName: "PalWorldSettings.ini", content, note, createdAt: Date.now() });
  await pruneConfigurationVersions(worldId);
}
async function writeAtomic(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

export async function readConfiguration(worldId: string) {
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const filePath = configPath(world.installDir, world.platform);
  try { return { path: filePath, exists: true, content: await readFile(filePath, "utf8"), running: world.status === "running" }; }
  catch {
    try { return { path: filePath, exists: false, content: await readFile(defaultPath(world.installDir), "utf8"), running: world.status === "running" }; }
    catch { return { path: filePath, exists: false, content: "", running: world.status === "running" }; }
  }
}

export async function saveConfiguration(worldId: string, content: string) {
  validate(content);
  const current = await readConfiguration(worldId);
  if (current.exists && current.content) await snapshot(worldId, current.content, "before edit");
  await writeAtomic(current.path, content);
  await snapshot(worldId, content, "saved");
  await database().insert(events).values({ worldId, kind: "settings", message: "Edited PalWorldSettings.ini (restart to apply)", createdAt: Date.now() });
  return { path: current.path, running: current.running };
}

export async function readConfigurationOptions(worldId: string) {
  const configuration = await readConfiguration(worldId);
  const world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  const [latest] = await database().select({ createdAt: configVersions.createdAt }).from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(1);
  const restartRequired = world.status === "running" && Boolean(latest && latest.createdAt > (world.lastStartedAt ?? 0));
  return { ...configuration, options: parseConfigurationOptions(configuration.content), restartRequired };
}

export async function saveConfigurationOptions(worldId: string, changes: Record<string, string>) {
  const configuration = await readConfiguration(worldId);
  return saveConfiguration(worldId, applyConfigurationOptions(configuration.content, changes));
}

type ManagedConfigurationOptions = { syncPublicPort?: boolean };

export function managedConfigurationChanges(world: WorldView, options: ManagedConfigurationOptions = {}): Record<string, string> {
  const changes: Record<string, string> = {
    RESTAPIEnabled: world.restApiEnabled ? "True" : "False",
    RESTAPIPort: String(world.restApiPort),
    RCONEnabled: world.rconEnabled ? "True" : "False",
    RCONPort: String(world.rconPort),
  };
  // PublicPort advertises an external/community-server port; it does not set
  // the local game listener. Seed it for new installs and update it only when
  // the manager-owned game port itself changes, preserving tunnel/NAT values.
  if (options.syncPublicPort) changes.PublicPort = String(world.gamePort);
  // An empty registry credential commonly means “not imported”, not “erase the
  // working game credential”. Explicit credential clearing belongs in its own UI.
  if (world.adminPassword) changes.AdminPassword = JSON.stringify(world.adminPassword);
  if (world.serverPassword) changes.ServerPassword = JSON.stringify(world.serverPassword);
  return changes;
}

export async function syncManagedConfiguration(worldId: string, options: ManagedConfigurationOptions = {}) {
  let world = await getWorld(worldId); if (!world) throw new Error("World not found.");
  if (world.restApiEnabled && !world.adminPassword) {
    const adminPassword = randomBytes(18).toString("base64url");
    await database().update(worlds).set({ adminPassword, updatedAt: Date.now() }).where(eq(worlds.id, worldId));
    await database().insert(events).values({ worldId, kind: "settings", message: "Generated the missing REST administrator credential", createdAt: Date.now() });
    world = { ...world, adminPassword };
  }
  const configuration = await readConfiguration(worldId);
  let source = configuration.content;
  let initialized = !configuration.exists;
  // Palworld creates an empty active file on first boot. Seed that file from
  // the shipped template so a fresh world has a complete, editable baseline.
  if (configuration.exists && !source.trim()) {
    try { source = await readFile(defaultPath(world.installDir), "utf8"); initialized = true; }
    catch { return { synchronized: false, initialized: false, reason: "The shipped default configuration is not available yet." }; }
  }
  if (!source) return { synchronized: false, initialized: false, reason: "PalWorldSettings.ini is not available yet." };
  let content = applyConfigurationOptions(source, managedConfigurationChanges(world, { syncPublicPort: initialized || options.syncPublicPort }));
  if (initialized) {
    // Match the established PSM behavior: use the shipped template as data, not
    // as the active file verbatim. This drops its instructional comments and
    // writes the canonical two-line Palworld configuration.
    content = serializeConfigurationOptions(parseConfigurationOptions(content));
    validate(content);
    await writeAtomic(configuration.path, content);
    await snapshot(worldId, content, "initialized from shipped defaults");
    await database().insert(events).values({ worldId, kind: "settings", message: "Initialized PalWorldSettings.ini from the shipped defaults", createdAt: Date.now() });
    return { synchronized: true, initialized: true, path: configuration.path, running: configuration.running };
  }
  const result = await saveConfiguration(worldId, content);
  return { synchronized: true, initialized: false, ...result };
}

export async function listConfigurationVersions(worldId: string) {
  const records = await database().select().from(configVersions).where(eq(configVersions.worldId, worldId)).orderBy(desc(configVersions.createdAt)).limit(50);
  return records.map(({ content, ...record }) => ({ ...record, sizeBytes: Buffer.byteLength(content) }));
}

export async function restoreConfiguration(worldId: string, versionId: string) {
  const [version] = await database().select().from(configVersions).where(and(eq(configVersions.id, versionId), eq(configVersions.worldId, worldId))).limit(1);
  if (!version) throw new Error("Configuration version not found.");
  const current = await readConfiguration(worldId);
  if (current.exists && current.content) await snapshot(worldId, current.content, "before restore");
  validate(version.content); await writeAtomic(current.path, version.content); await snapshot(worldId, version.content, `restored from ${versionId}`);
  await database().insert(events).values({ worldId, kind: "settings", message: `Restored PalWorldSettings.ini from ${versionId}`, createdAt: Date.now() });
  return { content: version.content, path: current.path, running: current.running };
}
