# Release process

PSM Next uses `1.0.0-pre.N` versions until the capability matrix is complete. Until 1.0.0 is tagged the database schema is still finding its final shape: the migration history is a single baseline migration that is regenerated in place when the schema changes, and a database created by an earlier development build is refused at startup and must be deleted. From 1.0.0 on, a migration that has appeared in a tagged release is immutable; schema changes always receive a new ordered migration and a new entry in the migration catalog.

## Publishing a release

A release is a pull request to `main` that bumps the version, opened by a workflow and merged by a person. Three workflows take part.

1. **Prepare release** (Actions → Prepare release → Run workflow, on `main`) picks the version with `npm version`, writes it to `package.json` and `package-lock.json` on a `release/v<version>` branch, and opens a pull request to `main`. Its inputs:

   - **release**: `patch`, `minor`, or `major`.
   - **prerelease**: on (the default) makes the version a prerelease with the `pre` label; off releases a stable version.

   | release | prerelease | from a stable version | from a prerelease |
   |---|---|---|---|
   | patch / minor / major | off | the next patch / minor / major (`1.0.0` → `1.0.1` / `1.1.0` / `2.0.0`) | `patch` releases the prerelease in flight as stable (`1.0.0-pre.3` → `1.0.0`) |
   | patch / minor / major | on | a new prerelease series at that level, starting at `.1` (`0.0.0` + major → `1.0.0-pre.1`) | counts the series in flight up (`1.0.0-pre.1` → `1.0.0-pre.2`) unless a higher level is chosen, which starts a new series (`1.0.1-pre.1` + minor → `1.1.0-pre.1`) |

   The version must be newer than `package.json` and every existing release tag, and only one release pull request may be open at a time. The pull request checks do not start on their own for this bot-opened pull request (GitHub does not run workflows for events caused by the workflow token); close and reopen it to run them, or run **Build release** on its branch.

2. **Review and merge** the pull request. Nothing is tagged or published until it is merged.

3. **Publish release** runs on the merge (on every push to `main` that changes `package.json`). If the version in `package.json` already has a tag, or is the `0.0.0` placeholder, it does nothing. Otherwise it builds the merge commit with Build release (every check, then the Linux AppImage, the Windows Setup installer, and the Windows portable exe), tags it `v<version>`, creates the GitHub release, and uploads the three files. The release is marked as a prerelease when the version has a label. Its notes are GitHub's automatic notes: for a prerelease, the pull requests merged since the previous tag of any kind; for a stable release, everything merged since the previous stable release, its prereleases included. The release pull requests themselves are left out by `.github/release.yml`. GitHub adds the source zip and tar.gz and shows each file's SHA-256 (also available as `digest` from the releases API); `SHA256SUMS.txt` stays in the workflow artifact and run summary.

   If it fails partway, fix the problem and run **Publish release** by hand on `main`: every step reuses what already exists (the tag, the release) and re-uploads the files.

There is no changelog file; release notes live on the GitHub release. Build artifacts are never committed. Prepare release needs the repository setting **Allow GitHub Actions to create and approve pull requests** (Settings → Actions → General → Workflow permissions).

The Windows builds are unsigned and labelled test builds in the release notes until they have been validated on a real Windows machine. The portable exe keeps its data in a `PSM-Data` folder beside it and cannot update itself.

## Building without publishing

**Build release** (Actions → Build release → Run workflow, on any branch, optionally naming a ref) runs every check, builds the three release files, exercises the Windows exes on a Windows runner, and keeps the files as workflow artifacts for 14 days. It never tags or publishes anything.

## Local builds

`npm run release` empties `release/` and builds all three artifacts with `SHA256SUMS.txt`, the same as the workflow. `npm run dist` builds them without emptying `release/` or writing the sums; `dist:linux` and `dist:windows` build one platform. On Linux the Windows builds are cross-built through Wine; the release script gives Wine a throwaway prefix with no display and no desktop integration.

The release builds and prepares the application once, then packages that output; `typecheck`, `lint`, `test`, and `test:e2e` are separate commands to run when you want them. Standalone `pack`, `dist`, and test commands remain usable independently.

To rehearse an update locally, quit the current manager, verify the artifact against `SHA256SUMS.txt`, make the versioned AppImage executable, and launch it directly.

## Updates in the application

Installed builds check GitHub Releases on the update channel chosen in Settings → Application updates: **Stable** offers only stable releases; **Prerelease** also offers prereleases. The channel defaults to Stable on every build; switch to Prerelease to be offered `pre` releases. Development runs (`npm run dev`, browser tests) never check.

The check only advertises a newer release. A newly launched AppImage compares its version with the last locally successful version, confirms the transition, and refreshes an existing launch-at-login entry. Before pending database migrations it creates one verified WAL-safe `registry-v3.pre-upgrade.sqlite` backup. Migration failures restore the original database and startup entry before the application exits.

A later milestone will download the applicable release file in the application, verify it against the SHA-256 `digest` GitHub's releases API reports for it, then restart into it. It will reuse this same local activation flow rather than coupling migrations or launch-at-login changes to GitHub discovery.

The manager-data directory remains launcher-owned. A Move manager data wizard is intentionally deferred until this upgrade and recovery process has accumulated operational use.


## Build and test tooling

The `scripts/` directory contains the development launcher (`dev.mjs`), standalone asset preparation (`prepare-standalone.mjs`), local release orchestration (`release.mjs`), and workflow version policy (`release/prepare.ts`). Integration fixtures and the native Windows artifact harness live under `e2e/`.

Package preparation preserves Next's normal `node_modules` layout. Electron Builder maps that directory explicitly through `extraResources`; the launcher does not rename dependencies or inject a custom module path. Next's tracing exclusions keep prepared output out of subsequent builds, and preparation rejects leaked source/data trees.

Playwright starts disposable fixtures but does not rebuild or recopy the package. Use `npm run test:e2e`, `test:e2e:browser`, or `test:e2e:electron` to prepare the required build automatically. Direct `npx playwright test` assumes a prepared build already exists (and `pack` has run for desktop tests).
