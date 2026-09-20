import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd(); const source = path.join(root, ".next", "standalone"); const destination = path.join(root, "dist-standalone");
if (!existsSync(source)) throw new Error("Missing .next/standalone. Run npm run build:web first.");
rmSync(destination, { recursive: true, force: true }); cpSync(source, destination, { recursive: true });
mkdirSync(path.join(destination, ".next"), { recursive: true }); cpSync(path.join(root, ".next", "static"), path.join(destination, ".next", "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(destination, "public"), { recursive: true }); cpSync(path.join(root, "drizzle"), path.join(destination, "drizzle"), { recursive: true });
console.log(`Prepared standalone application at ${destination}`);
