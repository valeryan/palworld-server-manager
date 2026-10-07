import { afterAll, describe, expect, it } from "vitest";
import { setupTestDataDirectory } from "./prepare-database";

setupTestDataDirectory("psm-update-channel-");
afterAll(() => { delete process.env.PSM_ADMIN_TOKEN; delete process.env.PSM_PACKAGED; });

describe("update channel setting", () => {
  it("defaults from the installed version, saves a choice, and refuses anything else", async () => {
    const { getUpdateChannel, saveUpdateChannel } = await import("@/server/services/update-channel");
    expect(await getUpdateChannel("1.0.0-alpha.2")).toBe("stable");
    expect(await getUpdateChannel("1.0.0")).toBe("stable");
    await expect(saveUpdateChannel("beta")).rejects.toThrow("invalid");
    expect(await saveUpdateChannel("stable")).toBe("stable");
    expect(await getUpdateChannel("1.0.0-alpha.2")).toBe("stable");
  });

  it("is read and changed through the settings API, and only packaged runs check for updates", async () => {
    process.env.PSM_ADMIN_TOKEN = "test-token"; const cookie = { cookie: "psm_admin=test-token" };
    const settings = await import("@/app/api/settings/route"); const update = await import("@/app/api/application/update/route");
    const patch = (body: unknown) => settings.PATCH(new Request("http://localhost/api/settings", { method: "PATCH", headers: { ...cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await (await patch({ updateChannel: "prerelease" })).json()).settings.updateChannel).toBe("prerelease");
    expect((await patch({ updateChannel: "nightly" })).status).toBeGreaterThanOrEqual(400);
    const read = await (await settings.GET(new Request("http://localhost/api/settings", { headers: cookie }))).json();
    expect(read.settings).toMatchObject({ updateChannel: "prerelease", updateChecksDisabled: "development" });
    const status = (await (await update.GET(new Request("http://localhost/api/application/update", { headers: cookie }))).json()).status;
    expect(status).toMatchObject({ channel: "prerelease", disabledReason: "development", updateAvailable: false });
  });
});
