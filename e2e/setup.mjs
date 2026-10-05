import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataDirectory = path.join(root, ".e2e-data");
const runtimeDirectory = path.join(root, ".e2e-runtime");
const worldDirectory = path.join(runtimeDirectory, "world");
const configDirectory = path.join(worldDirectory, "Pal", "Saved", "Config", "LinuxServer");

for (const target of [dataDirectory, runtimeDirectory]) await rm(target, { recursive: true, force: true });
await mkdir(path.join(worldDirectory, "Pal", "Saved", "SaveGames"), { recursive: true });
await mkdir(configDirectory, { recursive: true });
const executable = path.join(worldDirectory, "PalServer.sh");
await writeFile(executable, "#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n");
await chmod(executable, 0o700);
const configuration = '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="E2E World",Difficulty=None,ExpRate=1.000000)\n';
const shippedTemplate = await readFile(path.join(root, "tests/fixtures/DefaultPalWorldSettings-1.0.5.ini"), "utf8");
await writeFile(path.join(worldDirectory, "DefaultPalWorldSettings.ini"), shippedTemplate);
await writeFile(path.join(configDirectory, "PalWorldSettings.ini"), configuration);
await writeFile(path.join(worldDirectory, "Pal", "Saved", "SaveGames", "world.sav"), "isolated-e2e-save\n");
