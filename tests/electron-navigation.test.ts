import { describe, expect, it } from "vitest";
import { isSupersededNavigation } from "../electron/navigation";

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
