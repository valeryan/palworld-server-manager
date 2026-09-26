import { describe, expect, it } from "vitest";
import { desktopIconPath } from "../electron/desktop-icon";
import { isSupersededNavigation } from "../electron/navigation";
import { launchAtLoginArguments, normalizeManagerPort, parseCustomLaunchFlags, validateManagerPort } from "../electron/launch-options";

describe("Electron navigation errors", () => {
  it("recognizes a route that superseded loadURL", () => {
    expect(isSupersededNavigation(new Error("ERR_ABORTED (-3) loading 'http://127.0.0.1:4318/worlds/example'"))).toBe(true);
    expect(isSupersededNavigation(Object.assign(new Error("navigation cancelled"), { code: "ERR_ABORTED" }))).toBe(true);
    expect(isSupersededNavigation(Object.assign(new Error("navigation cancelled"), { errno: -3 }))).toBe(true);
  });

  it("does not suppress genuine startup failures", () => {
    expect(isSupersededNavigation(new Error("ERR_CONNECTION_REFUSED (-102)"))).toBe(false);
    expect(isSupersededNavigation("ERR_ABORTED (-3)")).toBe(false);
  });
});

describe("Electron desktop icons", () => {
  it("uses the development artwork only for development launches", () => {
    expect(desktopIconPath({ isDevelopment: true, platform: "linux", developmentRoot: "/workspace", resourcesPath: "/resources" })).toBe(
      "/workspace/public/spheres/pal-server-dev.png",
    );
    expect(desktopIconPath({ isDevelopment: false, platform: "linux", developmentRoot: "/workspace", resourcesPath: "/resources" })).toBe(
      "/resources/app/public/spheres/pal-server-normal.png",
    );
  });

  it("selects ICO artwork for Windows", () => {
    expect(desktopIconPath({ isDevelopment: true, platform: "win32", developmentRoot: "C:\\workspace", resourcesPath: "C:\\resources" })).toMatch(
      /pal-server-dev\.ico$/,
    );
    expect(desktopIconPath({ isDevelopment: false, platform: "win32", developmentRoot: "C:\\workspace", resourcesPath: "C:\\resources" })).toMatch(
      /pal-server-normal\.ico$/,
    );
  });
});

describe("Electron login launch options", () => {
  it("constructs managed and custom arguments without a shell", () => {
    expect(launchAtLoginArguments({ startHidden: true, disableGpu: true, forceX11: true, customFlags: '--enable-logging=stderr "--log-file=/tmp/PSM Next.log"' }, ["--user-data-dir=/tmp/psm data"])).toEqual([
      "--hidden", "--disable-gpu", "--ozone-platform=x11", "--enable-logging=stderr", "--log-file=/tmp/PSM Next.log", "--user-data-dir=/tmp/psm data",
    ]);
  });

  it("rejects positional, unsafe, duplicate-managed, and malformed custom flags", () => {
    expect(() => parseCustomLaunchFlags("not-a-flag")).toThrow("Invalid launch flag");
    expect(() => parseCustomLaunchFlags("--remote-debugging-port=9222")).toThrow("managed option");
    expect(() => parseCustomLaunchFlags("--disable-gpu")).toThrow("managed option");
    expect(() => parseCustomLaunchFlags("--enable-logging='unfinished")).toThrow("unfinished quote");
  });

  it("validates configured manager ports and safely defaults damaged preferences", () => {
    expect(validateManagerPort("4319")).toBe(4319);
    expect(() => validateManagerPort(80)).toThrow("between 1024 and 65535");
    expect(() => validateManagerPort(4318.5)).toThrow("whole number");
    expect(normalizeManagerPort("damaged")).toBe(4318);
  });
});
