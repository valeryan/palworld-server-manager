import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
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
rmSync(destination, { recursive: true, force: true }); cpSync(source, destination, { recursive: true });
// electron-builder intentionally filters directories named node_modules from
// extraResources. Keep Next's traced dependency tree under a neutral name and
// expose it to the standalone CommonJS loader through NODE_PATH at runtime.
renameSync(path.join(destination, "node_modules"), path.join(destination, "server-node_modules"));
mkdirSync(path.join(destination, ".next"), { recursive: true }); cpSync(path.join(root, ".next", "static"), path.join(destination, ".next", "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(destination, "public"), { recursive: true }); cpSync(path.join(root, "drizzle"), path.join(destination, "drizzle"), { recursive: true });
console.log(`Prepared standalone application at ${destination}`);
