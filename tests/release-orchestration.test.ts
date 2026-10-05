import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const script = path.resolve("scripts/release.mjs");
const roots: string[] = [];
const names = ["PSM-x64.AppImage", "PSM-Setup-x64.exe", "PSM-Portable-x64.exe"];

// Run the actual release script in a disposable directory. The tool doubles record build
// provenance, produce fixture packages, and never run npm, Wine or a real application.
const tool = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync("calls.jsonl", JSON.stringify({command, args, winePrefix: process.env.WINEPREFIX}) + "\n");
if (process.env.PSM_RELEASE_TEST_FAIL === (command === "npm" ? args[1] : command)) process.exit(19);
function build() {
  if (fs.existsSync("compiled.txt")) throw new Error("Source compiled more than once");
  fs.writeFileSync("compiled.txt", "fixture compiled output");
}
function prepare() { fs.copyFileSync("compiled.txt", "prepared.txt"); }
if (command === "npm") {
  if (args[1] === "test:e2e") {
    build(); prepare();
    fs.mkdirSync("release/linux-unpacked", {recursive:true});
    fs.copyFileSync("prepared.txt", "tested.txt");
  } else if (args[1] === "build") build();
  else if (args[1] === "prepare:standalone") prepare();
  else if (args[1] === "dist") throw new Error("dist would rebuild already-tested source");
} else if (command === "npx") {
  const contents = fs.readFileSync("prepared.txt", "utf8");
  if (fs.existsSync("tested.txt") && fs.readFileSync("tested.txt", "utf8") !== contents) throw new Error("Packaging different output from tests");
  fs.mkdirSync("release/win-unpacked", {recursive:true});
  for (const name of ["PSM-x64.AppImage", "PSM-Setup-x64.exe", "PSM-Portable-x64.exe", "installer.blockmap"]) fs.writeFileSync(path.join("release",name), contents);
}
`;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "psm-release-check-"));
  roots.push(root);
  await mkdir(path.join(root, "bin"));
  await mkdir(path.join(root, "temporary"));
  await mkdir(path.join(root, "release"));
  await writeFile(path.join(root, "release", "previous.exe"), "previous candidate");
  for (const name of ["npm", "npx", "wineserver"]) {
    await writeFile(path.join(root, "bin", name), tool, { mode: 0o700 });
  }
  const run = (args: string[] = [], failure = "") => execute(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, TMPDIR: path.join(root, "temporary"), PSM_RELEASE_TEST_FAIL: failure },
  });
  const calls = async () => (await readFile(path.join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { command: string; args: string[]; winePrefix?: string });
  return { root, run, calls };
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("release orchestration", () => {
  it("packages the checked build once, keeps exactly three artifacts and verifies their digests", async () => {
    const { root, run, calls } = await fixture();
    const result = await run();
    const trace = await calls();
    expect(trace.filter((call) => call.command === "npm").map((call) => call.args[1])).toEqual(["typecheck", "lint", "test", "test:e2e"]);
    expect(trace.find((call) => call.command === "npx")?.args).toEqual(["electron-builder", "--linux", "AppImage", "--win", "nsis", "portable", "--x64", "--publish", "never"]);
    expect((await readdir(path.join(root, "release"))).sort()).toEqual([...names, "SHA256SUMS.txt"].sort());
    const sums = await readFile(path.join(root, "release", "SHA256SUMS.txt"), "utf8");
    for (const name of names) {
      const content = await readFile(path.join(root, "release", name));
      expect(content.toString()).toBe(await readFile(path.join(root, "tested.txt"), "utf8"));
      expect(sums).toContain(`${createHash("sha256").update(content).digest("hex")}  ${name}`);
    }
    expect(trace.at(-1)?.command).toBe("wineserver");
    expect(await readdir(path.join(root, "temporary"))).toEqual([]);
    expect(result.stdout).toContain("Release candidate ready");
  });

  it("builds and prepares exactly once when checks are explicitly skipped", async () => {
    const { run, calls } = await fixture();
    await run(["--skip-checks"]);
    expect((await calls()).filter((call) => call.command === "npm").map((call) => call.args[1])).toEqual(["build", "prepare:standalone"]);
  });

  it("stops before cleaning the previous release if a check fails", async () => {
    const { root, run, calls } = await fixture();
    await expect(run([], "test:e2e")).rejects.toThrow();
    expect(await readFile(path.join(root, "release", "previous.exe"), "utf8")).toBe("previous candidate");
    expect((await calls()).some((call) => call.command === "npx")).toBe(false);
  });

  it("cleans its isolated Wine prefix and creates no success manifest after packaging fails", async () => {
    const { root, run, calls } = await fixture();
    await expect(run([], "npx")).rejects.toThrow();
    const trace = await calls();
    const prefix = trace.find((call) => call.command === "npx")?.winePrefix;
    expect(prefix).toContain(path.join(root, "temporary", "psm-release-wine-"));
    expect(trace.at(-1)).toMatchObject({ command: "wineserver", args: ["-k"], winePrefix: prefix });
    expect(await readdir(path.join(root, "temporary"))).toEqual([]);
    await expect(readFile(path.join(root, "release", "SHA256SUMS.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
