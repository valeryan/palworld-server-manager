import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Builds the release artifacts from one build: the Linux AppImage, the Windows NSIS installer,
// and the Windows portable exe (both cross-built through Wine), with a local SHA256SUMS.txt.
// Those three files are the release; GitHub adds the source archives. Checks and tests are
// separate steps (the pull-request workflow, `npm test`, `npm run test:e2e`), not part of a release.
//   node scripts/release.mjs             every artifact
//   node scripts/release.mjs --linux     the AppImage only (no Wine needed)
//   node scripts/release.mjs --windows   the Setup and portable exes only
// The workflows build the two platforms on separate runners at the same time; packaging is
// compression-bound, so that halves the wall clock. release/ is emptied first either way.
const root = process.cwd(); const release = path.join(root, "release");
const flags = process.argv.slice(2); const unknown = flags.filter((flag) => !["--linux", "--windows"].includes(flag));
if (unknown.length) throw new Error(`Unknown option ${unknown.join(" ")}; use --linux and/or --windows.`);
const linux = !flags.length || flags.includes("--linux"); const windows = !flags.length || flags.includes("--windows");
const artifacts = {
  ...(linux ? { linux: (name) => name.endsWith(".AppImage") } : {}),
  ...(windows ? { "windows installer": (name) => /-Setup-.*\.exe$/.test(name), "windows portable": (name) => /-Portable-.*\.exe$/.test(name) } : {}),
};

function run(command, args, env = process.env) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, env, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}.`))); }); }

await run("npm", ["run", "build"]);
await run("npm", ["run", "prepare:standalone"]);
await rm(release, { recursive: true, force: true });
// On Linux the NSIS build runs the installer under Wine to extract its uninstaller. Give it a
// throwaway prefix with no display, no Mono/Gecko prompts and no desktop integration, so it never
// touches ~/.wine or the user's menus and file associations.
const winePrefix = windows && process.platform === "linux" ? await mkdtemp(path.join(tmpdir(), "psm-release-wine-")) : null;
const inherited = { ...process.env }; delete inherited.DISPLAY;
const env = winePrefix ? { ...inherited, WINEPREFIX: winePrefix, WINEDEBUG: "-all", WINEDLLOVERRIDES: "mscoree,mshtml=;winemenubuilder.exe=d", WAYLAND_DISPLAY: "psm-headless-no-display" } : process.env;
const targets = [...(linux ? ["--linux", "AppImage"] : []), ...(windows ? ["--win", "nsis", "portable"] : [])];
// Package the output already built above; invoking dist here would compile it a second time.
try { await run("npx", ["electron-builder", ...targets, "--x64", "--publish", "never"], env); }
finally { if (winePrefix) { await run("wineserver", ["-k"], env).catch(() => undefined); await rm(winePrefix, { recursive: true, force: true }); } }
// release/ keeps only the release files; electron-builder's working output goes.
for (const name of await readdir(release)) if (!Object.values(artifacts).some((matches) => matches(name))) await rm(path.join(release, name), { recursive: true, force: true });
const files = await readdir(release); const sums = [];
for (const [platform, matches] of Object.entries(artifacts)) {
  const found = files.filter(matches);
  if (found.length !== 1) throw new Error(`Expected exactly one ${platform} artifact, found ${found.length}.`);
  sums.push(`${createHash("sha256").update(await readFile(path.join(release, found[0]))).digest("hex")}  ${found[0]}`);
}
await writeFile(path.join(release, "SHA256SUMS.txt"), `${sums.join("\n")}\n`, { mode: 0o644 });
console.log(`Release candidate ready in ${release}:\n${sums.join("\n")}`);
