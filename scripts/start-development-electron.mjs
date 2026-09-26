import { spawn } from "node:child_process";
import electron from "electron";
import { developmentEnvironment } from "./development-profile.mjs";

const environment = developmentEnvironment();
delete environment.ELECTRON_RUN_AS_NODE;

const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try { await fetch(environment.ELECTRON_START_URL, { method: "HEAD" }); ready = true; break; }
  catch { await new Promise((resolve) => setTimeout(resolve, 350)); }
}
if (!ready) throw new Error(`The development web server did not answer at ${environment.ELECTRON_START_URL} within 60 seconds.`);

const child = spawn(electron, ["."], { env: environment, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => process.exit(code ?? 1));
