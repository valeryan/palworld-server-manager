import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { developmentEnvironment } from "./development-profile.mjs";

const environment = developmentEnvironment();
const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", environment.PSM_PORT], { env: environment, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => process.exit(code ?? 1));
