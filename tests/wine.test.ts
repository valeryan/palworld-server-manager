import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let directory: string; let wine: string; let calls: string;
const world = (overrides: Record<string, unknown> = {}) => ({ id: "wine-world", platform: "windows" as const, wineBinary: wine, winePrefix: null as string | null, ...overrides });

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "psm-wine-test-"));
  process.env.PALWORLD_MANAGER_DATA_DIR = path.join(directory, "data");
  calls = path.join(directory, "calls.log"); wine = path.join(directory, "wine");
  // Records each invocation and the environment that matters, and fakes what wineboot/reg write.
  await writeFile(wine, `#!/bin/sh
echo "$* | prefix=$WINEPREFIX display=\${DISPLAY-unset} wayland=\${WAYLAND_DISPLAY-unset} overrides=$WINEDLLOVERRIDES debug=$WINEDEBUG" >> "${path.join(directory, "calls.log")}"
if [ "$1" = wineboot ] && [ ! -d "$(dirname "$WINEPREFIX")" ]; then echo "wine: chdir to $WINEPREFIX : No such file or directory" >&2; exit 1; fi
if [ "$1" = wineboot ]; then mkdir "$WINEPREFIX" && : > "$WINEPREFIX/system.reg" && printf '[Software\\\\\\\\Wine]\\n' > "$WINEPREFIX/user.reg"; fi
if [ "$1" = reg ]; then printf '[Software\\\\\\\\Wine\\\\\\\\Drivers]\\n"Graphics"="null"\\n' >> "$WINEPREFIX/user.reg"; fi
`);
  await chmod(wine, 0o755);
  await writeFile(path.join(directory, "wineserver"), `#!/bin/sh
echo "wineserver $* | prefix=$WINEPREFIX" >> "${path.join(directory, "calls.log")}"
`);
  await chmod(path.join(directory, "wineserver"), 0o755);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("headless Wine prefixes", () => {
  it("creates a manager-owned prefix without prompts or a display, then makes it headless once", async () => {
    const { prepareWinePrefix, effectiveWinePrefix } = await import("@/server/services/wine");
    const log: string[] = [];
    await prepareWinePrefix(world(), { ...process.env, DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", WINEDLLOVERRIDES: "dwmapi=n,b", WINEDEBUG: undefined }, (line) => log.push(line));
    const prefix = effectiveWinePrefix(world());
    expect(prefix).toBe(path.join(directory, "data", "wine-prefixes", "wine-world"));
    const recorded = (await readFile(calls, "utf8")).trim().split("\n");
    expect(recorded).toHaveLength(3);
    expect(recorded[0]).toBe(`wineboot -i | prefix=${prefix} display=unset wayland=psm-headless-no-display overrides=dwmapi=n,b;mscoree,mshtml=;winemenubuilder.exe=d debug=-all`);
    expect(recorded[1]).toContain("reg add HKCU\\Software\\Wine\\Drivers /v Graphics /d null /f");
    expect(recorded[2]).toBe(`wineserver -w | prefix=${prefix}`);
    expect(log.some((line) => line.includes("first start only"))).toBe(true);
    await prepareWinePrefix(world(), { ...process.env }, () => undefined);
    expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("never changes a user-supplied prefix that already exists, and says why", async () => {
    const { prepareWinePrefix } = await import("@/server/services/wine");
    const custom = path.join(directory, "shared-prefix"); await mkdir(custom, { recursive: true });
    await writeFile(path.join(custom, "system.reg"), ""); await writeFile(path.join(custom, "user.reg"), "[Software\\\\Wine]\n");
    await rm(calls, { force: true });
    const log: string[] = [];
    await prepareWinePrefix(world({ winePrefix: custom }), { ...process.env }, (line) => log.push(line));
    await expect(readFile(calls, "utf8")).rejects.toThrow();
    expect(log.join("\n")).toContain("is not headless");
  });

  it("does nothing for native Linux worlds", async () => {
    const { prepareWinePrefix, runsUnderWine } = await import("@/server/services/wine");
    await rm(calls, { force: true });
    await prepareWinePrefix(world({ platform: "linux" }), { ...process.env }, () => undefined);
    await expect(readFile(calls, "utf8")).rejects.toThrow();
    expect(runsUnderWine({ platform: "windows" }, "win32")).toBe(false);
    expect(runsUnderWine({ platform: "windows" }, "linux")).toBe(true);
  });

  it("launches Windows worlds with their own prefix and quiet Wine output unless the world overrides them", async () => {
    const { commandFor } = await import("@/server/services/processes");
    const { createWorldSchema } = await import("@/contracts/world");
    const base = { ...createWorldSchema.parse({ displayName: "Wine", installDir: "/srv/wine", platform: "windows" }), id: "wine-world", status: "stopped" as const, processId: null, buildId: null, latestBuildId: null, lastStartedAt: null, createdAt: 1, updatedAt: 1 };
    expect(commandFor(base).env).toMatchObject({ WINEPREFIX: path.join(directory, "data", "wine-prefixes", "wine-world"), WINEDEBUG: "-all" });
    expect(commandFor({ ...base, winePrefix: "/srv/prefix" }).env.WINEPREFIX).toBe("/srv/prefix");
    expect(commandFor(base).env.WINEDLLOVERRIDES?.split(";")).toContain("winemenubuilder.exe=d");
    expect(commandFor({ ...base, env: { WINEDLLOVERRIDES: "dwmapi=n,b" } }).env.WINEDLLOVERRIDES).toBe("dwmapi=n,b;winemenubuilder.exe=d");
    expect(commandFor({ ...base, env: { WINEDEBUG: "err+all", WINEPREFIX: "/srv/env-prefix" } }).env).toMatchObject({ WINEDEBUG: "err+all", WINEPREFIX: "/srv/env-prefix" });
  });
});
