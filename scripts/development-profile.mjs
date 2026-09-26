import path from "node:path";
import { fileURLToPath } from "node:url";

export const developmentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultDevelopmentPort = 4319;
export const defaultDevelopmentDataDir = path.resolve(developmentRoot, "../psm-next-development/manager-data");

export function developmentEnvironment(source = process.env) {
  const explicitUrl = source.ELECTRON_START_URL ? new URL(source.ELECTRON_START_URL) : undefined;
  if (explicitUrl && explicitUrl.protocol !== "http:") throw new Error("ELECTRON_START_URL must use HTTP.");
  const port = String(source.PSM_PORT ?? explicitUrl?.port ?? defaultDevelopmentPort);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("PSM_PORT must be a valid TCP port.");
  if (explicitUrl && source.PSM_PORT && String(explicitUrl.port || 80) !== port) throw new Error("PSM_PORT and ELECTRON_START_URL must use the same port.");
  const url = explicitUrl?.toString().replace(/\/$/, "") ?? `http://127.0.0.1:${port}`;
  return {
    ...source,
    PSM_PORT: port,
    ELECTRON_START_URL: url,
    PALWORLD_MANAGER_DATA_DIR: source.PALWORLD_MANAGER_DATA_DIR || defaultDevelopmentDataDir,
  };
}
