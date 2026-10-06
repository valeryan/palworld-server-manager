import { posixArguments, windowsArguments } from "../src/lib/arguments";

export type LaunchAtLoginOptions = {
  argumentFormat?: "legacy" | "windows";
  startHidden: boolean;
  disableGpu: boolean;
  forceX11: boolean;
  customFlags: string;
};

export const defaultLaunchAtLoginOptions: LaunchAtLoginOptions = { startHidden: true, disableGpu: false, forceX11: false, customFlags: "" };
export const defaultManagerPort = 4318;

export function validateManagerPort(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) throw new Error("Manager port must be a whole number between 1024 and 65535.");
  return port;
}

export function normalizeManagerPort(value: unknown): number { try { return validateManagerPort(value); } catch { return defaultManagerPort; } }

const reserved = new Set(["hidden", "user-data-dir", "disable-gpu", "ozone-platform", "disable-dev-shm-usage", "no-sandbox", "no-zygote", "remote-debugging-address", "remote-debugging-port"]);

export function normalizeLaunchAtLoginOptions(value: unknown): LaunchAtLoginOptions {
  const saved = value && typeof value === "object" ? value as Partial<LaunchAtLoginOptions> : {};
  return { startHidden: saved.startHidden !== false, disableGpu: saved.disableGpu === true, forceX11: saved.forceX11 === true, customFlags: typeof saved.customFlags === "string" ? saved.customFlags : "", ...(saved.argumentFormat ? { argumentFormat: saved.argumentFormat } : {}) };
}

export function parseCustomLaunchFlags(value: string, format: "legacy" | "windows" = "legacy"): string[] {
  if (value.length > 2_048) throw new Error("Custom launch flags cannot exceed 2,048 characters.");
  if (/[\r\n\0]/.test(value)) throw new Error("Custom launch flags cannot contain line breaks or NUL bytes.");
  const flags = format === "windows" ? windowsArguments(value) : posixArguments(value, { escapeInSingleQuotes: true, unfinishedMessage: "Custom launch flags contain an unfinished quote or escape." });
  if (flags.length > 32) throw new Error("Custom launch flags are limited to 32 arguments.");
  for (const flag of flags) {
    if (flag.length > 256 || !/^--[a-zA-Z0-9][a-zA-Z0-9-]*(?:=.*)?$/.test(flag)) throw new Error(`Invalid launch flag: ${flag}`);
    const name = flag.slice(2).split("=", 1)[0]!.toLowerCase();
    if (reserved.has(name)) throw new Error(`Use the managed option for --${name}; it cannot be added as a custom flag.`);
  }
  return flags;
}

export function launchAtLoginArguments(options: LaunchAtLoginOptions, preserved: string[] = []): string[] {
  return [options.startHidden ? "--hidden" : "", options.disableGpu ? "--disable-gpu" : "", options.forceX11 ? "--ozone-platform=x11" : "", ...parseCustomLaunchFlags(options.customFlags, options.argumentFormat), ...preserved].filter(Boolean);
}
