import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

describe("desktop authentication proxy", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("protects manager pages and APIs but leaves the current language pack reachable", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/settings" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/worlds" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/mods" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/mods" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/i18n/current" })).toBe(false);
  });
  it("rejects a foreign cookie on desktop APIs and pages and accepts only the launch token", () => {
    vi.stubEnv("PSM_ADMIN_TOKEN", "desktop-secret");
    const denied = proxy(new NextRequest("http://localhost/api/settings", { headers: { cookie: "psm_remote=guest" } }));
    const allowed = proxy(new NextRequest("http://localhost/api/settings", { headers: { cookie: "psm_admin=desktop-secret" } }));
    const page = proxy(new NextRequest("http://localhost/settings", { headers: { cookie: "psm_remote=guest" } }));
    expect(denied.status).toBe(401);
    expect(page.status).toBe(401);
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });
});
