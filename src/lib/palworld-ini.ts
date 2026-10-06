import { Buffer } from "node:buffer";
import { scanTuple } from "./tuple-scanner";

// INI text operations: no manager profile, database or filesystem access.
export function validateConfiguration(content: string) {
  if (Buffer.byteLength(content) > 2000000) throw new Error("Configuration exceeds the 2 MB safety limit.");
  if (content.includes("\0")) throw new Error("Configuration contains a NUL byte.");
  const match = content.match(/OptionSettings=\((.*)\)/s);
  if (!match) throw new Error("Configuration must contain OptionSettings=(...).");
  const scan = scanTuple(match[1] ?? "");
  if (scan.negative) throw new Error("OptionSettings contains unbalanced parentheses.");
  if (scan.quoted || scan.depth !== 0) throw new Error("OptionSettings contains unbalanced quotes or parentheses.");
}
export function splitConfigurationOptions(body: string) {
  const parts: string[] = [];
  let start = 0;
  scanTuple(body, (index) => { parts.push(body.slice(start, index)); start = index + 1; });
  parts.push(body.slice(start));
  return parts;
}
export function parseConfigurationOptions(content: string): Record<string, string> {
  const body = content.match(/OptionSettings=\((.*)\)/s)?.[1];
  if (body == null) return {};
  return Object.fromEntries(splitConfigurationOptions(body).filter(part => part.trim()).flatMap(part => {
    const separator = part.indexOf("=");
    return separator > 0 ? [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]] : [];
  }));
}
export function serializeConfigurationOptions(options: Record<string, string>) {
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${Object.entries(options).map(([key, value]) => `${key}=${value}`).join(",")})\n`;
}
export function applyConfigurationOptions(content: string, changes: Record<string, string>) {
  const match = content.match(/OptionSettings=\((.*)\)/s);
  if (!match || match.index == null) throw new Error("Configuration must contain OptionSettings=(...).");
  const tokens = splitConfigurationOptions(match[1] ?? "").filter(part => part.trim());
  const positions = new Map(tokens.map((part, index) => [part.slice(0, part.indexOf("=")).trim(), index]));
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid configuration key: ${key}`);
    if (/[\r\n\0]/.test(value) || value.length > 8192) throw new Error(`Invalid configuration value for ${key}.`);
    const token = `${key}=${value}`;
    const index = positions.get(key);
    if (index == null) {
      positions.set(key, tokens.length);
      tokens.push(token);
    } else tokens[index] = token;
  }
  const start = match.index + "OptionSettings=(".length;
  const result = `${content.slice(0, start)}${tokens.join(",")}${content.slice(start + (match[1]?.length ?? 0))}`;
  validateConfiguration(result);
  return result;
}
function decodeString(value: string, key: string) {
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded === "string") return decoded;
  } catch {/* below */}
  throw new Error(`${key} must be a quoted string.`);
}
export function configurationCredentials(content: string) {
  const options = parseConfigurationOptions(content);
  return {
    adminPassword: Object.hasOwn(options, "AdminPassword") ? decodeString(options.AdminPassword!, "AdminPassword") : "",
    serverPassword: Object.hasOwn(options, "ServerPassword") ? decodeString(options.ServerPassword!, "ServerPassword") : ""
  };
}
export function configurationIsValid(content: string): boolean {
  try {
    validateConfiguration(content);
    return true;
  } catch {
    return false;
  }
}
