import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd(); const release = path.join(root, "release");
function run(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}.`))); }); }

await rm(release, { recursive: true, force: true });
for (const script of ["typecheck", "lint", "test", "test:e2e"]) await run("npm", ["run", script]);
await rm(release, { recursive: true, force: true });
await run("npm", ["run", "dist:linux"]);
const artifacts = (await readdir(release)).filter((name) => name.endsWith(".AppImage"));
if (artifacts.length !== 1) throw new Error(`Expected exactly one AppImage, found ${artifacts.length}.`);
const name = artifacts[0]; const digest = createHash("sha256").update(await readFile(path.join(release, name))).digest("hex");
await writeFile(path.join(release, "SHA256SUMS.txt"), `${digest}  ${name}\n`, { mode: 0o644 });
console.log(`Release candidate ready: ${path.join(release, name)}`);
