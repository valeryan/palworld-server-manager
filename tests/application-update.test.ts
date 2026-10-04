import { afterEach, describe, expect, it } from "vitest";
import { applicationUpdateStatus, clearApplicationUpdateCache } from "@/server/services/application-update";
import { compareSemanticVersions } from "@/lib/semver";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const release = (version: string, options: { prerelease?: boolean; draft?: boolean } = {}) => ({ tag_name: `v${version}`, html_url: `https://github.test/releases/${version}`, published_at: "2026-09-27T00:00:00Z", prerelease: options.prerelease ?? false, draft: options.draft ?? false });
afterEach(() => clearApplicationUpdateCache());

describe("application update discovery", () => {
  it("compares stable and prerelease versions correctly", () => { expect(compareSemanticVersions("1.0.0", "1.0.0-alpha.2")).toBe(1); expect(compareSemanticVersions("1.0.0-alpha.10", "1.0.0-alpha.2")).toBe(1); expect(compareSemanticVersions("1.2.3", "1.2.3")).toBe(0); });
  it("treats an empty release list as a normal no-update result", async () => { await expect(applicationUpdateStatus("1.0.0-alpha.2", { fetcher: async () => response([]), force: true, now: 1 })).resolves.toMatchObject({ updateAvailable: false, publishedVersion: null }); });
  it("lets prerelease builds see prereleases and stable builds see only stable releases", async () => {
    const releases = [release("1.2.0-beta.1"), release("1.1.0-alpha.1", { prerelease: true }), release("1.0.1")];
    await expect(applicationUpdateStatus("1.0.0-alpha.2", { fetcher: async () => response(releases), force: true, now: 2 })).resolves.toMatchObject({ updateAvailable: true, publishedVersion: "1.2.0-beta.1" });
    await expect(applicationUpdateStatus("1.0.0", { fetcher: async () => response(releases), force: true, now: 3 })).resolves.toMatchObject({ updateAvailable: true, publishedVersion: "1.0.1" });
  });
  it("follows the chosen channel instead of the installed version", async () => {
    const releases = [release("1.1.0-alpha.1", { prerelease: true }), release("1.0.1")];
    await expect(applicationUpdateStatus("1.0.0-alpha.2", { channel: "stable", fetcher: async () => response(releases[1]), force: true, now: 8 })).resolves.toMatchObject({ channel: "stable", updateAvailable: true, publishedVersion: "1.0.1" });
    await expect(applicationUpdateStatus("1.0.0", { channel: "prerelease", fetcher: async () => response(releases), force: true, now: 9 })).resolves.toMatchObject({ channel: "prerelease", updateAvailable: true, publishedVersion: "1.1.0-alpha.1" });
    await expect(applicationUpdateStatus("1.0.0-alpha.2", { fetcher: async () => response([]), force: true, now: 10 })).resolves.toMatchObject({ channel: "prerelease" });
    await expect(applicationUpdateStatus("1.0.0", { fetcher: async () => response([]), force: true, now: 11 })).resolves.toMatchObject({ channel: "stable" });
  });
  it("asks the stable endpoint on the stable channel and the release list on the prerelease channel", async () => {
    const urls: string[] = []; const fetcher = (async (url: string) => { urls.push(url); return response([]); }) as unknown as typeof fetch;
    await applicationUpdateStatus("1.0.0-alpha.2", { channel: "stable", fetcher, force: true, now: 12 });
    await applicationUpdateStatus("1.0.0-alpha.2", { channel: "prerelease", fetcher, force: true, now: 13 });
    expect(urls[0]).toMatch(/\/releases\/latest$/); expect(urls[1]).toMatch(/\/releases\?per_page=20$/);
  });
  it("never contacts GitHub in development runs", async () => {
    let calls = 0; const fetcher = async () => { calls += 1; return response([release("9.0.0")]); };
    await expect(applicationUpdateStatus("1.0.0", { disabled: "development", fetcher, force: true, now: 14 })).resolves.toMatchObject({ disabledReason: "development", updateAvailable: false, publishedVersion: null });
    expect(calls).toBe(0);
  });
  it("ignores drafts, malformed tags, and releases that are not newer", async () => { const releases = [release("2.0.0", { draft: true }), { tag_name: "latest", html_url: "https://invalid" }, release("1.0.0")]; await expect(applicationUpdateStatus("1.0.0", { fetcher: async () => response(releases), force: true, now: 4 })).resolves.toMatchObject({ updateAvailable: false }); });
  it("keeps GitHub failures non-blocking and caches results", async () => { let calls = 0; const fetcher = async () => { calls += 1; return response({}, 503); }; const first = await applicationUpdateStatus("1.0.0", { fetcher, now: 5 }); const second = await applicationUpdateStatus("1.0.0", { fetcher, now: 6 }); expect(first.updateAvailable).toBe(false); expect(second).toEqual(first); expect(calls).toBe(1); });
  it("treats timeouts and offline failures as normal no-update results", async () => {
    for (const failure of [new DOMException("Timed out", "TimeoutError"), new TypeError("fetch failed")]) await expect(applicationUpdateStatus("1.0.0", { fetcher: async () => { throw failure; }, force: true, now: 7 })).resolves.toMatchObject({ updateAvailable: false, publishedVersion: null });
  });
});
