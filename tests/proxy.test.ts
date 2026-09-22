import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

describe("desktop authentication proxy", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("protects manager pages and APIs but leaves the remote entry and API reachable", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/settings" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/worlds" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/remote" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/remote/login" })).toBe(false);
  });
  it("rejects a remote cookie on desktop APIs and accepts only the launch token", () => {
    vi.stubEnv("PSM_ADMIN_TOKEN", "desktop-secret");
    const denied = proxy(new NextRequest("http://localhost/api/settings", { headers: { cookie: "psm_remote=guest" } }));
    const allowed = proxy(new NextRequest("http://localhost/api/settings", { headers: { cookie: "psm_admin=desktop-secret" } }));
    expect(denied.status).toBe(401);
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });
});
