import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Builds every release artifact from one verified build: the Linux AppImage, the Windows NSIS
// installer, and the Windows portable exe (both cross-built through Wine), with the update
// metadata in-app updates read and a local SHA256SUMS.txt.
//   node scripts/release.mjs [--skip-checks]
// release/ is emptied first, so every release is built cleanly from source.
const root = process.cwd(); const release = path.join(root, "release");
const artifacts = { linux: (name) => name.endsWith(".AppImage"), "windows installer": (name) => /-Setup-.*\.exe$/.test(name), "windows portable": (name) => /-Portable-.*\.exe$/.test(name) };

function run(command, args, env = process.env) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, env, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}.`))); }); }

if (!process.argv.includes("--skip-checks")) for (const script of ["typecheck", "lint", "test", "test:e2e"]) await run("npm", ["run", script]);
await rm(release, { recursive: true, force: true });
// On Linux the NSIS build runs the installer under Wine to extract its uninstaller. Give it a
// throwaway prefix with no display, no Mono/Gecko prompts and no desktop integration, so it never
// touches ~/.wine or the user's menus and file associations.
const winePrefix = process.platform === "linux" ? await mkdtemp(path.join(tmpdir(), "psm-release-wine-")) : null;
const inherited = { ...process.env }; delete inherited.DISPLAY;
const env = winePrefix ? { ...inherited, WINEPREFIX: winePrefix, WINEDEBUG: "-all", WINEDLLOVERRIDES: "mscoree,mshtml=;winemenubuilder.exe=d", WAYLAND_DISPLAY: "psm-headless-no-display" } : process.env;
try { await run("npm", ["run", "dist"], env); }
finally { if (winePrefix) { await run("wineserver", ["-k"], env).catch(() => undefined); await rm(winePrefix, { recursive: true, force: true }); } }
const files = await readdir(release); const sums = [];
for (const [platform, matches] of Object.entries(artifacts)) {
  const found = files.filter(matches);
  if (found.length !== 1) throw new Error(`Expected exactly one ${platform} artifact, found ${found.length}.`);
  sums.push(`${createHash("sha256").update(await readFile(path.join(release, found[0]))).digest("hex")}  ${found[0]}`);
}
for (const metadata of ["latest.yml", "latest-linux.yml"]) if (!files.includes(metadata)) throw new Error(`electron-builder did not write ${metadata}; in-app updates need it.`);
await writeFile(path.join(release, "SHA256SUMS.txt"), `${sums.join("\n")}\n`, { mode: 0o644 });
console.log(`Release candidate ready in ${release}:\n${sums.join("\n")}`);
