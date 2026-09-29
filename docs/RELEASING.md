# Release process

PSM Next uses `1.0.0-alpha.N` versions until the capability matrix is complete. A migration that has appeared in an installed milestone is immutable; schema changes always receive a new ordered migration and a new entry in the migration catalog.

Run `npm run release:linux` from a clean, current `main`. It runs source, browser, and packaged-Electron verification, creates exactly one versioned AppImage, and writes `release/SHA256SUMS.txt`. During local milestones, do not create a tag or GitHub Release. To rehearse an update, quit the current manager, verify the artifact against `SHA256SUMS.txt`, make the versioned AppImage executable, and launch it directly.

For a future published prerelease, update the changelog and package version, merge through the normal checks, tag the exact `main` commit as `v<package-version>`, and push the tag. The tag-only workflow uses the same release command, verifies the tag/version match, publishes the AppImage and checksum, and marks hyphenated versions as prereleases.

The running manager checks GitHub Releases only to advertise a newer applicable release; no release is required for local upgrade detection. A newly launched AppImage compares its version with the last locally successful version, confirms the transition, and refreshes an existing launch-at-login entry. Before pending database migrations it creates one verified WAL-safe `registry-v3.pre-upgrade.sqlite` backup. Migration failures restore the original database and startup entry before the application exits.

A later automatic-upgrade milestone will download and verify the applicable release artifact in the application, then restart into it. It will reuse this same local activation flow rather than coupling migrations or launch-at-login changes to GitHub discovery.

The manager-data directory remains launcher-owned. A Move manager data wizard is intentionally deferred until this upgrade and recovery process has accumulated operational use.
