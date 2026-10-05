import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const developmentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDevelopmentPort = 4319;
const defaultDevelopmentWorldPortOffset = 1000;
const defaultDevelopmentDataDir = path.resolve(developmentRoot, "../psm-next-development/manager-data");

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
    // New development worlds default to 9211/28015/9212/26575 so they never
    // collide with production servers on the same host.
    PALWORLD_MANAGER_WORLD_PORT_OFFSET: source.PALWORLD_MANAGER_WORLD_PORT_OFFSET ?? String(defaultDevelopmentWorldPortOffset),
  };
}

async function launch(role) {
  if (role !== "web" && role !== "electron") throw new Error("Usage: node scripts/dev.mjs web|electron");
  const environment = developmentEnvironment();
  let command; let args;
  if (role === "web") {
    command = process.execPath;
    args = [createRequire(import.meta.url).resolve("next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", environment.PSM_PORT];
  } else {
    delete environment.ELECTRON_RUN_AS_NODE;
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { await fetch(environment.ELECTRON_START_URL, { method: "HEAD" }); ready = true; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 350)); }
    }
    if (!ready) throw new Error(`The development web server did not answer at ${environment.ELECTRON_START_URL} within 60 seconds.`);
    command = (await import("electron")).default;
    args = ["."];
  }
  const child = spawn(command, args, { env: environment, stdio: "inherit", windowsHide: true });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  child.once("error", (error) => { console.error(error); process.exitCode = 1; });
  child.once("exit", (code) => process.exit(code ?? 1));
}

// Importing the profile in tests must not start a development server.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await launch(process.argv[2]);
