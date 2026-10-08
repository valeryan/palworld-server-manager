import { describe, expect, it } from "vitest";
import { checkReleaseVersion, releaseKeywords } from "../scripts/release/prepare";

describe("release keywords", () => {
  it("starts a new prerelease series at .1 from a stable version", () => {
    expect(releaseKeywords("0.0.0", "major", true)).toEqual(["premajor", "prerelease"]);
    expect(releaseKeywords("1.0.0", "patch", true)).toEqual(["prepatch", "prerelease"]);
    expect(releaseKeywords("1.2.3", "minor", true)).toEqual(["preminor", "prerelease"]);
  });
  it("counts an in-flight series up unless a higher level is asked for", () => {
    expect(releaseKeywords("1.0.0-pre.1", "patch", true)).toEqual(["prerelease"]);
    expect(releaseKeywords("1.0.0-pre.1", "major", true)).toEqual(["prerelease"]);
    expect(releaseKeywords("1.0.1-pre.1", "patch", true)).toEqual(["prerelease"]);
    expect(releaseKeywords("1.0.1-pre.1", "minor", true)).toEqual(["preminor", "prerelease"]);
    expect(releaseKeywords("1.1.0-pre.2", "patch", true)).toEqual(["prerelease"]);
    expect(releaseKeywords("1.1.0-pre.2", "major", true)).toEqual(["premajor", "prerelease"]);
  });
  it("releases stable versions with the plain keyword", () => {
    expect(releaseKeywords("1.0.0-pre.3", "patch", false)).toEqual(["patch"]);
    expect(releaseKeywords("1.0.0", "minor", false)).toEqual(["minor"]);
    expect(releaseKeywords("0.0.0", "major", false)).toEqual(["major"]);
  });
  it("refuses bad input", () => {
    expect(() => releaseKeywords("1.0", "patch", true)).toThrow("not a semantic version");
    expect(() => releaseKeywords("1.0.0", "huge" as never, true)).toThrow("not patch, minor, or major");
  });
});

describe("release version rules", () => {
  it("accepts a newer version, finds the previous release tag, and flags prereleases", () => {
    expect(checkReleaseVersion({ version: "1.0.0-pre.1", current: "0.0.0", tags: [] })).toEqual({ tag: "v1.0.0-pre.1", previousTag: null, prerelease: true });
    expect(checkReleaseVersion({ version: "1.0.0", current: "1.0.0-pre.10", tags: ["v1.0.0-pre.3", "v1.0.0-pre.10", "v1.0.0-pre.9", "other"] })).toEqual({ tag: "v1.0.0", previousTag: null, prerelease: false });
    expect(checkReleaseVersion({ version: "1.1.0-pre.1", current: "1.0.0", tags: ["v1.0.0"] })).toEqual({ tag: "v1.1.0-pre.1", previousTag: "v1.0.0", prerelease: true });
    expect(checkReleaseVersion({ version: "1.0.0-pre.2", tags: ["v1.0.0-pre.1"] })).toEqual({ tag: "v1.0.0-pre.2", previousTag: "v1.0.0-pre.1", prerelease: true });
  });
  it("ranges a stable release from the previous stable tag and a prerelease from the previous tag of any kind", () => {
    const tags = ["v1.0.0", "v1.1.0-pre.1", "v1.1.0-pre.2"];
    expect(checkReleaseVersion({ version: "1.1.0", current: "1.1.0-pre.2", tags })).toEqual({ tag: "v1.1.0", previousTag: "v1.0.0", prerelease: false });
    expect(checkReleaseVersion({ version: "1.1.0-pre.3", current: "1.1.0-pre.2", tags })).toEqual({ tag: "v1.1.0-pre.3", previousTag: "v1.1.0-pre.2", prerelease: true });
  });
  it("refuses bad input, existing tags, and versions that are not newer", () => {
    expect(() => checkReleaseVersion({ version: "v1.0.0", current: "0.9.0", tags: [] })).toThrow("no leading v");
    expect(() => checkReleaseVersion({ version: "1.0", current: "0.9.0", tags: [] })).toThrow("not a version");
    expect(() => checkReleaseVersion({ version: "1.0.0-pre.1", current: "0.0.0", tags: ["v1.0.0-pre.1"] })).toThrow("already exists");
    expect(() => checkReleaseVersion({ version: "0.0.0", current: "0.0.0", tags: [] })).toThrow("not newer than the current");
    expect(() => checkReleaseVersion({ version: "1.0.0-pre.3", current: "1.0.0-pre.2", tags: ["v1.0.0-pre.4"] })).toThrow("not newer than the released v1.0.0-pre.4");
  });
});
