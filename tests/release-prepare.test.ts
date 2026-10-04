import { describe, expect, it } from "vitest";
import { addChangelogEntry, checkReleaseVersion } from "../scripts/release/prepare";

describe("release version rules", () => {
  it("accepts a newer version and finds the previous release tag", () => {
    expect(checkReleaseVersion({ version: "1.0.0-alpha.3", prerelease: true, current: "1.0.0-alpha.2", tags: [] })).toEqual({ tag: "v1.0.0-alpha.3", previousTag: null });
    expect(checkReleaseVersion({ version: "1.0.0", prerelease: false, current: "1.0.0-alpha.10", tags: ["v1.0.0-alpha.3", "v1.0.0-alpha.10", "v1.0.0-alpha.9", "other"] })).toEqual({ tag: "v1.0.0", previousTag: "v1.0.0-alpha.10" });
    expect(checkReleaseVersion({ version: "1.1.0", prerelease: true, current: "1.0.0", tags: ["v1.0.0"] }).tag).toBe("v1.1.0");
  });
  it("refuses bad input, prerelease labels released as stable, existing tags, and versions that are not newer", () => {
    expect(() => checkReleaseVersion({ version: "v1.0.0", prerelease: false, current: "0.9.0", tags: [] })).toThrow("no leading v");
    expect(() => checkReleaseVersion({ version: "1.0", prerelease: false, current: "0.9.0", tags: [] })).toThrow("not a version");
    expect(() => checkReleaseVersion({ version: "1.0.0-alpha.3", prerelease: false, current: "1.0.0-alpha.2", tags: [] })).toThrow("must be released as a prerelease");
    expect(() => checkReleaseVersion({ version: "1.0.0-alpha.3", prerelease: true, current: "1.0.0-alpha.2", tags: ["v1.0.0-alpha.3"] })).toThrow("already exists");
    expect(() => checkReleaseVersion({ version: "1.0.0-alpha.2", prerelease: true, current: "1.0.0-alpha.2", tags: [] })).toThrow("not newer than the current");
    expect(() => checkReleaseVersion({ version: "1.0.0-alpha.3", prerelease: true, current: "1.0.0-alpha.2", tags: ["v1.0.0-alpha.4"] })).toThrow("not newer than the released v1.0.0-alpha.4");
  });
});

describe("changelog entry", () => {
  it("adds the release above the previous ones with GitHub's headings nested under it", () => {
    const changelog = "# Changelog\n\n## 1.0.0-alpha.2 — local milestone\n\n- Older.\n";
    const notes = "## What's Changed\n* Mod support by @valeryan in #5\n\n**Full Changelog**: https://github.test/compare\n";
    expect(addChangelogEntry(changelog, "1.0.0-alpha.3", "2026-10-05", notes)).toBe("# Changelog\n\n## 1.0.0-alpha.3 — 2026-10-05\n\n### What's Changed\n* Mod support by @valeryan in #5\n\n**Full Changelog**: https://github.test/compare\n\n## 1.0.0-alpha.2 — local milestone\n\n- Older.\n");
  });
});
