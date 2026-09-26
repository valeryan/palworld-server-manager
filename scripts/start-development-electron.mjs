import { spawn } from "node:child_process";
import electron from "electron";

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], { env: environment, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => process.exit(code ?? 1));
