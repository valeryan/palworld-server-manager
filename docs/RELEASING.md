# Release process

PSM Next uses `1.0.0-alpha.N` versions until the capability matrix is complete. Until 1.0.0 is tagged the database schema is still finding its final shape: the migration history is a single baseline migration that is regenerated in place when the schema changes, and a database created by an earlier development build is refused at startup and must be deleted. From 1.0.0 on, a migration that has appeared in a tagged release is immutable; schema changes always receive a new ordered migration and a new entry in the migration catalog.

## Publishing a release

Releases are cut by the **Generate release** workflow (Actions → Generate release → Run workflow, on `main`). It takes three inputs:

- **version**: the version to release, without a leading `v`, for example `1.0.0-alpha.3`. It must be newer than `package.json` and every existing release tag.
- **prerelease**: marks the GitHub release as a prerelease and keeps it from becoming "latest". Versions with a label (`-alpha.3`, `-beta.1`) must be prereleases.
- **dry run**: checks and builds everything and keeps the files as workflow artifacts for 14 days, but changes nothing on `main`, tags, or releases.

The workflow then:

1. Checks the version, generates the release notes with GitHub's automatic notes (merged pull requests since the previous release tag), and writes one release commit on a temporary `release/v<version>` branch: the new version in `package.json` and `package-lock.json`, and the notes added to `CHANGELOG.md`.
2. Runs every check against that commit (typecheck, lint, import cycles, unit tests, browser and packaged-Electron workflows), then builds it and packages the Linux AppImage, the Windows Setup installer, and the Windows portable exe. The checks are workflow steps; `npm run release` itself only builds. The portable exe keeps its data in a `PSM-Data` folder beside it and cannot update itself.
3. Only when every artifact is built: moves `main` to the release commit (a fast-forward; if `main` moved during the run, it stops and publishes nothing), tags it `v<version>`, creates the GitHub release with the generated notes, and uploads the three files. GitHub adds the source zip and tar.gz to every release and shows each file's SHA-256 (also available as `digest` from the releases API); `SHA256SUMS.txt` stays in the workflow artifact and run summary.
4. Removes the temporary branch.

Build artifacts are never committed; they live on the GitHub release.

If a run fails before publishing, `main`, tags, and releases are untouched; fix the problem and run it again. If it fails after `main` has moved, the branch is kept: use **Re-run failed jobs**. Every publishing step reuses what already exists (the tag, the release) and re-uploads the files, so a re-run finishes the release.

The Windows builds are unsigned and labelled test builds in the release notes until they have been validated on a real Windows machine.

## Local builds

`npm run release` empties `release/` and builds all three artifacts with `SHA256SUMS.txt`, the same as the workflow. `npm run dist` builds them without emptying `release/` or writing the sums; `dist:linux` and `dist:windows` build one platform. On Linux the Windows builds are cross-built through Wine; the release script gives Wine a throwaway prefix with no display and no desktop integration.

The release builds and prepares the application once, then packages that output; `typecheck`, `lint`, `test`, and `test:e2e` are separate commands to run when you want them. Standalone `pack`, `dist`, and test commands remain usable independently.

To rehearse an update locally, quit the current manager, verify the artifact against `SHA256SUMS.txt`, make the versioned AppImage executable, and launch it directly.

## Updates in the application

Installed builds check GitHub Releases on the update channel chosen in Settings → Application updates: **Stable** offers only stable releases; **Prerelease** also offers prereleases. The channel defaults to Stable on every build; switch to Prerelease to be offered alpha and beta releases. Development runs (`npm run dev`, browser tests) never check.

The check only advertises a newer release. A newly launched AppImage compares its version with the last locally successful version, confirms the transition, and refreshes an existing launch-at-login entry. Before pending database migrations it creates one verified WAL-safe `registry-v3.pre-upgrade.sqlite` backup. Migration failures restore the original database and startup entry before the application exits.

A later milestone will download the applicable release file in the application, verify it against the SHA-256 `digest` GitHub's releases API reports for it, then restart into it. It will reuse this same local activation flow rather than coupling migrations or launch-at-login changes to GitHub discovery.

The manager-data directory remains launcher-owned. A Move manager data wizard is intentionally deferred until this upgrade and recovery process has accumulated operational use.


## Build and test tooling

The `scripts/` directory contains the development launcher (`dev.mjs`), standalone asset preparation (`prepare-standalone.mjs`), local release orchestration (`release.mjs`), and workflow version/changelog policy (`release/prepare.ts`). Integration fixtures and the native Windows artifact harness live under `e2e/`.

Package preparation preserves Next's normal `node_modules` layout. Electron Builder maps that directory explicitly through `extraResources`; the launcher does not rename dependencies or inject a custom module path. Next's tracing exclusions keep prepared output out of subsequent builds, and preparation rejects leaked source/data trees.

Playwright starts disposable fixtures but does not rebuild or recopy the package. Use `npm run test:e2e`, `test:e2e:browser`, or `test:e2e:electron` to prepare the required build automatically. Direct `npx playwright test` assumes a prepared build already exists (and `pack` has run for desktop tests).
