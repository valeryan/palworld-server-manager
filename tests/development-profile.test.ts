import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

function resolveProfile(environment: Record<string, string> = {}) {
  const script = `import { developmentEnvironment } from ${JSON.stringify(path.join(process.cwd(), "scripts/development-profile.mjs"))}; console.log(JSON.stringify(developmentEnvironment({})))`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], { env: { ...process.env, ...environment }, encoding: "utf8" })) as Record<string, string>;
}

describe("development profile", () => {
  it("uses the isolated port, origin, and data directory for standalone commands", () => {
    const profile = resolveProfile();
    expect(profile.PSM_PORT).toBe("4319");
    expect(profile.ELECTRON_START_URL).toBe("http://127.0.0.1:4319");
    expect(profile.PALWORLD_MANAGER_DATA_DIR).toBe(path.resolve(process.cwd(), "../psm-next-development/manager-data"));
  });

  it("preserves explicit environment overrides", () => {
    const script = `import { developmentEnvironment } from ${JSON.stringify(path.join(process.cwd(), "scripts/development-profile.mjs"))}; console.log(JSON.stringify(developmentEnvironment({ PSM_PORT: "5001", PALWORLD_MANAGER_DATA_DIR: "/tmp/psm-profile" })))`;
    const profile = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8" })) as Record<string, string>;
    expect(profile).toMatchObject({ PSM_PORT: "5001", ELECTRON_START_URL: "http://127.0.0.1:5001", PALWORLD_MANAGER_DATA_DIR: "/tmp/psm-profile" });
  });

  it("rejects conflicting port and renderer overrides", () => {
    const script = `import { developmentEnvironment } from ${JSON.stringify(path.join(process.cwd(), "scripts/development-profile.mjs"))}; developmentEnvironment({ PSM_PORT: "5001", ELECTRON_START_URL: "http://127.0.0.1:5002" })`;
    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", stdio: "pipe" })).toThrow();
  });
});
