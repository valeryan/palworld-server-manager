import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

type Snapshot = { digest: string; entries: Map<string, string> };

function repeated(args: string[], name: string): string[] {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]!] : []);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined;
}

async function protectedRoots(args: string[]): Promise<string[]> {
  const candidates = repeated(args, "--protect"); const sourceDatabase = option(args, "--source-db");
  if (sourceDatabase) {
    const database = new DatabaseSync(await realpath(path.resolve(sourceDatabase)), { readOnly: true });
    try {
      const columns = database.prepare("PRAGMA table_info(worlds)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "install_dir")) throw new Error("The source database does not contain worlds.install_dir.");
      candidates.push(...(database.prepare("SELECT install_dir FROM worlds WHERE install_dir IS NOT NULL AND install_dir <> ''").all() as Array<{ install_dir: string }>).map((row) => row.install_dir));
    } finally { database.close(); }
  }
  const canonical = await Promise.all(candidates.map(async (candidate) => {
    const resolved = await realpath(path.resolve(candidate)); const information = await stat(resolved);
    if (!information.isDirectory()) throw new Error(`Protected source is not a directory: ${resolved}`);
    if (resolved === path.parse(resolved).root) throw new Error("Refusing to use a filesystem root as a protected source.");
    return resolved;
  }));
  return [...new Set(canonical)].sort((left, right) => left.length - right.length).filter((candidate, index, all) => !all.slice(0, index).some((parent) => {
    const relative = path.relative(parent, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }));
}

async function snapshot(root: string): Promise<Snapshot> {
  const output = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; const child = spawn("find", ["-P", root, "-printf", "%P\\0%y\\0%s\\0%T@\\0%C@\\0%l\\0"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk)); child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`find exited with ${code} while scanning ${root}`)));
  });
  const fields = output.toString("utf8").split("\0"); const entries = new Map<string, string>();
  for (let index = 0; index + 5 < fields.length; index += 6) entries.set(fields[index]!, fields.slice(index + 1, index + 6).join("\0"));
  const hash = createHash("sha256");
  for (const [name, metadata] of [...entries].sort(([left], [right]) => left.localeCompare(right))) hash.update(name).update("\0").update(metadata).update("\0");
  return { digest: hash.digest("hex"), entries };
}

function changes(before: Snapshot, after: Snapshot): string[] {
  const names = new Set([...before.entries.keys(), ...after.entries.keys()]);
  return [...names].filter((name) => before.entries.get(name) !== after.entries.get(name)).sort();
}

async function run(command: string[], roots: string[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: "inherit", env: { ...process.env, PSM_PROTECTED_ROOTS: roots.join(path.delimiter) } });
    child.on("error", reject); child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const separator = process.argv.indexOf("--");
if (separator < 0 || separator === process.argv.length - 1) throw new Error("Usage: npm run test:guarded -- --source-db /path/registry.sqlite -- command [args...] (or repeat --protect /path)");
const args = process.argv.slice(2, separator); const command = process.argv.slice(separator + 1); const roots = await protectedRoots(args);
if (!roots.length) throw new Error("At least one --protect directory or --source-db is required.");
console.log(`Protecting ${roots.length} original server tree${roots.length === 1 ? "" : "s"}:\n${roots.map((root) => `  ${root}`).join("\n")}`);
const before = new Map<string, Snapshot>(); for (const root of roots) before.set(root, await snapshot(root));
const commandStatus = await run(command, roots); let guardFailed = false;
for (const root of roots) {
  const after = await snapshot(root); const prior = before.get(root)!;
  if (prior.digest === after.digest) continue;
  guardFailed = true; const changed = changes(prior, after);
  console.error(`Protected source tree changed: ${root}\n${changed.slice(0, 20).map((name) => `  ${name || "."}`).join("\n")}${changed.length > 20 ? `\n  …and ${changed.length - 20} more` : ""}`);
}
if (guardFailed) throw new Error("Original server-tree write guard detected a change.");
console.log("Original server-tree write guard passed: no metadata or directory entries changed.");
process.exitCode = commandStatus;
