import { cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd(); const source = path.join(root, ".next", "standalone"); const destination = path.join(root, "dist-standalone");
if (!existsSync(source)) throw new Error("Missing .next/standalone. Run npm run build:web first.");
// Unbounded filesystem paths in server code make Next trace the whole repository into the
// package, including local data and release artifacts. Refuse to ship such a build.
const leaked = [".data-next", ".scratchpad", "release", "tests", "e2e", "playwright-report", "dist-standalone"].filter((name) => existsSync(path.join(source, name)));
if (leaked.length) throw new Error(`The standalone build traced repository-only paths (${leaked.join(", ")}). Mark world or user paths with /* turbopackIgnore: true */.`);
// Server source is compiled into .next; a traced .ts file means a path the tracer read as "this module's folder".
const sources = existsSync(path.join(source, "src")) ? readdirSync(path.join(source, "src"), { recursive: true }).map(String).filter((file) => /\.tsx?$/.test(file)) : [];
if (sources.length) throw new Error(`The standalone build traced ${sources.length} source file(s) (${sources.slice(0, 3).join(", ")}). Mark world or user paths with /* turbopackIgnore: true */.`);
// Turbopack links its hashed external aliases (.next/node_modules/<package>-<hash>) to node_modules
// with relative symlinks. The default copy rewrites those into absolute paths on the build machine,
// which resolve there (so every local test passes) and nowhere else: v1.0.0's AppImage shipped a
// link into /home/runner. Copy the links verbatim, then refuse any that point outside the package.
rmSync(destination, { recursive: true, force: true }); cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
const escaping = readdirSync(destination, { recursive: true, withFileTypes: true }).filter((entry) => entry.isSymbolicLink()).map((entry) => {
  const link = path.join(entry.parentPath, entry.name); const target = readlinkSync(link); const resolved = path.resolve(path.dirname(link), target);
  return path.isAbsolute(target) || !resolved.startsWith(destination + path.sep) || !existsSync(resolved) ? `${path.relative(destination, link)} -> ${target}` : null;
}).filter(Boolean);
if (escaping.length) throw new Error(`The standalone build contains symlinks that would break outside this machine: ${escaping.join("; ")}`);
// package.json maps node_modules separately because electron-builder filters that
// directory at the root of an extraResources source. Keep normal Node resolution.
mkdirSync(path.join(destination, ".next"), { recursive: true }); cpSync(path.join(root, ".next", "static"), path.join(destination, ".next", "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(destination, "public"), { recursive: true }); cpSync(path.join(root, "drizzle"), path.join(destination, "drizzle"), { recursive: true });
console.log(`Prepared standalone application at ${destination}`);
