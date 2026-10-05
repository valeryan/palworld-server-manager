# Release process

PSM Next uses `1.0.0-alpha.N` versions until the capability matrix is complete. A migration that has appeared in an installed milestone is immutable; schema changes always receive a new ordered migration and a new entry in the migration catalog.

## Publishing a release

Releases are cut by the **Generate release** workflow (Actions → Generate release → Run workflow, on `main`). It takes three inputs:

- **version**: the version to release, without a leading `v`, for example `1.0.0-alpha.3`. It must be newer than `package.json` and every existing release tag.
- **prerelease**: marks the GitHub release as a prerelease and keeps it from becoming "latest". Versions with a label (`-alpha.3`, `-beta.1`) must be prereleases.
- **dry run**: builds and verifies everything and keeps the files as workflow artifacts for 14 days, but changes nothing on `main`, tags, or releases.

The workflow then:

1. Checks the version, generates the release notes with GitHub's automatic notes (merged pull requests since the previous release tag), and writes one release commit on a temporary `release/v<version>` branch: the new version in `package.json` and `package-lock.json`, and the notes added to `CHANGELOG.md`.
2. Builds that commit: typecheck, lint, unit tests, browser and packaged-Electron workflows, then from the same build the Linux AppImage, the Windows Setup installer, and the Windows portable exe. The portable exe keeps its data in a `PSM-Data` folder beside it and cannot update itself.
3. Only when every artifact is built: moves `main` to the release commit (a fast-forward; if `main` moved during the run, it stops and publishes nothing), tags it `v<version>`, creates the GitHub release with the generated notes, and uploads the three files. GitHub adds the source zip and tar.gz to every release and shows each file's SHA-256 (also available as `digest` from the releases API); `SHA256SUMS.txt` stays in the workflow artifact and run summary.
4. Removes the temporary branch.

Build artifacts are never committed; they live on the GitHub release.

If a run fails before publishing, `main`, tags, and releases are untouched; fix the problem and run it again. If it fails after `main` has moved, the branch is kept: use **Re-run failed jobs**. Every publishing step reuses what already exists (the tag, the release) and re-uploads the files, so a re-run finishes the release.

The Windows builds are unsigned and labelled test builds in the release notes until they have been validated on a real Windows machine.

## Local builds

`npm run release` runs every check, empties `release/`, and builds all three artifacts with `SHA256SUMS.txt`, the same as the workflow. `npm run dist` builds them without the checks; `dist:linux` and `dist:windows` build one platform. On Linux the Windows builds are cross-built through Wine; the release script gives Wine a throwaway prefix with no display and no desktop integration.

The checked release packages the build prepared by `test:e2e`; it does not compile the application again after the tests. `npm run release -- --skip-checks` still builds and prepares the application once before packaging. Standalone `pack`, `dist`, and test commands remain usable independently.

To rehearse an update locally, quit the current manager, verify the artifact against `SHA256SUMS.txt`, make the versioned AppImage executable, and launch it directly.

## Updates in the application

Installed builds check GitHub Releases on the update channel chosen in Settings → Application updates: **Stable** offers only stable releases; **Prerelease** also offers prereleases. Without a choice, an installed prerelease follows Prerelease and a stable build follows Stable. Development runs (`npm run dev`, browser tests) never check.

The check only advertises a newer release. A newly launched AppImage compares its version with the last locally successful version, confirms the transition, and refreshes an existing launch-at-login entry. Before pending database migrations it creates one verified WAL-safe `registry-v3.pre-upgrade.sqlite` backup. Migration failures restore the original database and startup entry before the application exits.

A later milestone will download the applicable release file in the application, verify it against the SHA-256 `digest` GitHub's releases API reports for it, then restart into it. It will reuse this same local activation flow rather than coupling migrations or launch-at-login changes to GitHub discovery.

The manager-data directory remains launcher-owned. A Move manager data wizard is intentionally deferred until this upgrade and recovery process has accumulated operational use.
