import { readFileSync, writeFileSync } from "node:fs";
import { compareSemanticVersions, isPrerelease, parseSemanticVersion } from "../../src/lib/semver";

// Release rules the Generate release workflow checks before it changes anything.
export function checkReleaseVersion(input: { version: string; prerelease: boolean; current: string; tags: string[] }): { tag: string; previousTag: string | null } {
  const { version, prerelease, current, tags } = input;
  if (version.startsWith("v") || !parseSemanticVersion(version)) throw new Error(`"${version}" is not a version like 1.0.0 or 1.0.0-alpha.3 (no leading v).`);
  if (isPrerelease(version) && !prerelease) throw new Error(`${version} has a prerelease label, so it must be released as a prerelease.`);
  const tag = `v${version}`;
  if (tags.includes(tag)) throw new Error(`Tag ${tag} already exists.`);
  if ((compareSemanticVersions(version, current) ?? 0) <= 0) throw new Error(`${version} is not newer than the current version ${current}.`);
  const released = tags.filter((name) => /^v/.test(name) && parseSemanticVersion(name.slice(1))).sort((a, b) => compareSemanticVersions(b.slice(1), a.slice(1)) ?? 0);
  const newer = released.find((name) => (compareSemanticVersions(name.slice(1), version) ?? 0) >= 0);
  if (newer) throw new Error(`${version} is not newer than the released ${newer}.`);
  return { tag, previousTag: released[0] ?? null };
}

// Adds the release to the top of CHANGELOG.md, below its title. GitHub's generated notes use
// "##" headings, which are moved one level down to sit under the release heading.
export function addChangelogEntry(changelog: string, version: string, date: string, notes: string): string {
  const body = notes.trim().replace(/^(#{2,5}) /gm, "#$1 ");
  const entry = `## ${version} — ${date}\n\n${body}\n\n`;
  const firstRelease = changelog.search(/^## /m);
  return firstRelease < 0 ? `${changelog.trimEnd()}\n\n${entry}` : `${changelog.slice(0, firstRelease)}${entry}${changelog.slice(firstRelease)}`;
}

// CLI used by the workflow:
//   tsx scripts/release/prepare.ts check <version> <prerelease> <tags…>   → prints previous tag
//   tsx scripts/release/prepare.ts changelog <version> <date> <notes-file>
if (process.argv[1]?.endsWith("prepare.ts")) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") {
    const [version, prerelease, ...tags] = args;
    const current = JSON.parse(readFileSync("package.json", "utf8")).version as string;
    const result = checkReleaseVersion({ version: version ?? "", prerelease: prerelease === "true", current, tags });
    console.log(result.previousTag ?? "");
  } else if (command === "changelog") {
    const [version, date, notesFile] = args;
    writeFileSync("CHANGELOG.md", addChangelogEntry(readFileSync("CHANGELOG.md", "utf8"), version!, date!, readFileSync(notesFile!, "utf8")));
  } else throw new Error(`Unknown command "${command}"; use check or changelog.`);
}
