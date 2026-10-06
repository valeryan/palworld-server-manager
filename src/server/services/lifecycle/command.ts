import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WorldView } from "@/contracts/world";
import { posixArguments, windowsArguments } from "@/lib/arguments";
import { assertSupportedTarget, hostPlatform } from "@/server/host";
import { effectiveWinePrefix, runsUnderWine, serverWineOverrides } from "../wine";

// The server command line for a world: pure, apart from checking that the executable exists.

export function executableAvailable(command: string, env: NodeJS.ProcessEnv): boolean {
  if (command.includes(path.sep)) return existsSync(command);
  return (env.PATH ?? "").split(path.delimiter).some((directory) => existsSync(path.join(/* turbopackIgnore: true */ directory, command)));
}

export function parseArguments(value: string): string[] { return posixArguments(value, { unfinishedMessage: "Launch arguments contain an unfinished quote or escape." }); }

export function commandFor(world: WorldView): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  assertSupportedTarget(world.platform);
  const serverArgs = [
    `-port=${world.gamePort}`, `-queryport=${world.queryPort}`,
    ...(world.communityServer ? ["-publiclobby"] : []),
    ...(world.restApiEnabled ? ["-RESTAPIEnabled=true", `-RESTAPIPort=${world.restApiPort}`] : []),
    ...(world.rconEnabled ? ["-RCONEnabled=true", `-RCONPort=${world.rconPort}`] : []),
    ...(world.legacyPerfFlags ? ["-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"] : []),
    ...(world.argumentFormat === "windows" ? windowsArguments(world.extraArgs) : parseArguments(world.extraArgs)),
  ];
  const env: NodeJS.ProcessEnv = { ...process.env, ...world.env };
  if (runsUnderWine(world)) {
    // World environment values win so a prefix or debug channel can still be set deliberately.
    env.WINEPREFIX = world.env.WINEPREFIX ?? effectiveWinePrefix(world);
    env.WINEDEBUG = world.env.WINEDEBUG ?? "-all";
    env.WINEDLLOVERRIDES = serverWineOverrides(env.WINEDLLOVERRIDES);
    return { command: world.wineBinary, args: [...parseArguments(world.wineLaunchFlags), path.join(/* turbopackIgnore: true */ world.installDir, "PalServer.exe"), ...serverArgs], env };
  }
  if (hostPlatform() === "win32") {
    // PalServer.exe starts this console-subsystem binary with a fresh STARTUPINFO,
    // losing windowsHide and redirected output. Spawn the same game directly so
    // DETACHED_PROCESS and our file handles apply to the process that actually runs.
    return {
      command: path.join(/* turbopackIgnore: true */ world.installDir, "Pal", "Binaries", "Win64", "PalServer-Win64-Shipping-Cmd.exe"),
      args: ["Pal", ...serverArgs, "-NoConsole", "-stdout", "-FullStdOutLogOutput", "-FORCELOGFLUSH"], env,
    };
  }
  return { command: path.join(/* turbopackIgnore: true */ world.installDir, "PalServer.sh"), args: serverArgs, env };
}
