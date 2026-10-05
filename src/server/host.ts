// Resolve the host inside the running Node process, never in the Linux web compiler.
// This module also runs in Electron's migration preflight (no server-only import).
export function hostPlatform(): NodeJS.Platform {
  return process.getBuiltinModule("node:os").platform();
}
export function hostCapabilities() {
  const platform = hostPlatform();
  return { platform, defaultWorldPlatform: platform === "win32" ? "windows" : "linux",
    worldPlatforms: platform === "win32" ? ["windows"] : platform === "linux" ? ["linux", "windows"] : [],
    wine: platform === "linux", x11: platform === "linux" };
}
export function assertSupportedTarget(target: string): void {
  if (!hostCapabilities().worldPlatforms.includes(target)) throw new Error(`Cannot run a ${target} world on ${hostPlatform()}. Choose a supported platform.`);
}
export function assertLocalWindowsPath(candidate: string): void {
  if (hostPlatform() === "win32" && !/^[a-z]:[\\/]/i.test(candidate)) throw new Error("Windows runtime storage must use an absolute local drive path; network and extended paths are not supported.");
}
export async function privateFile(file: string): Promise<void> {
  if (hostPlatform() !== "win32") await process.getBuiltinModule("node:fs/promises").chmod(file, 0o600);
}
