import { describe, expect, it } from "vitest";
import { isSupersededNavigation } from "../electron/navigation";
import { launchAtLoginArguments, parseCustomLaunchFlags } from "../electron/launch-options";

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
});
