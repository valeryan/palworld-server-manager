import { compareSemanticVersions, isPrerelease, parseSemanticVersion } from "../../src/lib/semver";

export type ReleaseLevel = "patch" | "minor" | "major";
const levels: ReleaseLevel[] = ["patch", "minor", "major"];

// The `npm version` keywords, run in order, that take `current` to the requested release.
// With prerelease on, a series already in flight at the chosen level or higher counts up
// (pre.1 → pre.2); otherwise a new series starts and the second keyword moves npm's `.0` to `.1`.
export function releaseKeywords(current: string, level: ReleaseLevel, prerelease: boolean): string[] {
  const parsed = parseSemanticVersion(current);
  if (!parsed) throw new Error(`"${current}" is not a semantic version.`);
  if (!levels.includes(level)) throw new Error(`"${level}" is not patch, minor, or major.`);
  if (!prerelease) return [level];
  if (parsed.prerelease.length) {
    // Only pre<level> bumps produce prerelease bases, so the base's shape names the series' level.
    const inFlight: ReleaseLevel = parsed.patch > 0 ? "patch" : parsed.minor > 0 ? "minor" : "major";
    if (levels.indexOf(level) <= levels.indexOf(inFlight)) return ["prerelease"];
  }
  return [`pre${level}`, "prerelease"];
}

// Release rules checked before anything is pushed or published. `current` is the version being
// replaced (omitted when checking what is already on main against the release tags).
export function checkReleaseVersion(input: { version: string; current?: string; tags: string[] }): { tag: string; previousTag: string | null; prerelease: boolean } {
  const { version, current, tags } = input;
  if (version.startsWith("v") || !parseSemanticVersion(version)) throw new Error(`"${version}" is not a version like 1.0.0 or 1.0.0-pre.1 (no leading v).`);
  const tag = `v${version}`;
  if (tags.includes(tag)) throw new Error(`Tag ${tag} already exists.`);
  if (current !== undefined && (compareSemanticVersions(version, current) ?? 0) <= 0) throw new Error(`${version} is not newer than the current version ${current}.`);
  const released = tags.filter((name) => /^v/.test(name) && parseSemanticVersion(name.slice(1))).sort((a, b) => compareSemanticVersions(b.slice(1), a.slice(1)) ?? 0);
  const newer = released.find((name) => (compareSemanticVersions(name.slice(1), version) ?? 0) >= 0);
  if (newer) throw new Error(`${version} is not newer than the released ${newer}.`);
  // A prerelease's notes cover what changed since the previous tag of any kind; a stable release's
  // notes cover everything since the previous stable release, its prereleases included.
  const prerelease = isPrerelease(version);
  const previousTag = (prerelease ? released : released.filter((name) => !isPrerelease(name.slice(1))))[0] ?? null;
  return { tag, previousTag, prerelease };
}

// CLI used by the release workflows:
//   tsx scripts/release/prepare.ts keywords <current> <patch|minor|major> <true|false>  → npm version keywords, space-separated
//   tsx scripts/release/prepare.ts check <version> <current|-> <tags…>                 → previous-tag=… and prerelease=… for $GITHUB_OUTPUT
if (process.argv[1]?.endsWith("prepare.ts")) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "keywords") {
    const [current, level, prerelease] = args;
    console.log(releaseKeywords(current ?? "", level as ReleaseLevel, prerelease === "true").join(" "));
  } else if (command === "check") {
    const [version, current, ...tags] = args;
    const result = checkReleaseVersion({ version: version ?? "", current: current === "-" ? undefined : current ?? "", tags });
    console.log(`previous-tag=${result.previousTag ?? ""}\nprerelease=${result.prerelease}`);
  } else throw new Error(`Unknown command "${command}"; use keywords or check.`);
}
