# Palworld Server Manager — Next

Clean Next.js 16 and Electron rewrite focused on reliable management of multiple Palworld dedicated servers. The original application remains the behavioral reference; this branch does not preserve its internal architecture.

This is a personal, independently maintained hard fork and is not affiliated with or endorsed by the original project.

## Requirements

- Node.js 24 (`.nvmrc`)
- npm 11+
- Linux is the first packaging target

With `nvm`, run `nvm use` from the repository to select the version recorded in `.nvmrc`.

## Development

```bash
npm install
npm run dev
```

Development uses port `4319` and the isolated `../psm-next-development/manager-data` directory. `npm run dev`, `npm run dev:web`, and `npm run dev:electron` resolve the same profile, so the web and Electron commands can also be launched in separate terminals. Override `PSM_PORT`, `ELECTRON_START_URL`, or `PALWORLD_MANAGER_DATA_DIR` explicitly when a different disposable profile is needed.

The development profile is a self-contained sandbox and needs no setup: on first launch the manager creates its own database, SteamCMD copy, logs, and desktop state under `manager-data/`. It never reads the production manager data. Worlds for testing are installed or adopted from the development app itself. Keep them next to the data directory, for example `../psm-next-development/<world>/`, so the whole profile can be deleted or reset in one place. New worlds are offered the next free ports: each service continues from the highest port already registered, skipping numbers another service uses. The development profile sets `PALWORLD_MANAGER_WORLD_PORT_OFFSET=1000`, so its first world defaults to 9211/28015/9212/26575 (game/query/REST/RCON) instead of Palworld's 8211/27015/8212/25575 and won't collide with production servers on the same host.

## Safety model

- The manager's registry is `registry-v3.sqlite` in its own data directory. Existing servers are brought in with **New world → Use existing server**, which registers the installation in place; the manager never reads another manager's data.
- A registered world may not share or nest its installation directory with another world.
- Ports must be unique within and across worlds.
- Operations are serialized per world and represented as persistent jobs.
- Persistent operation, activity, server-log, and configuration history has configurable age/count retention in Application Settings; active operations are never removed.
- Backups are verified before use, restores require a stopped server, and restores create a pre-restore backup.
- Pending manager-database migrations run before background work and create verified WAL-safe backups with automatic failure recovery.
- API responses never include server passwords, admin passwords, or process environment variables.
- English is the protected fallback language. Additional PSM Next JSON packs can be installed from Application Settings and are stored under the manager data directory; incomplete packs fall back to English. See [language packs](./docs/LANGUAGE-PACKS.md) for the pack format.

To test against a copy of an existing server, copy its installation folder into the development profile (for example `../psm-next-development/<world>/`) and add it with **New world → Use existing server** in the development app. The copy gets development ports, so it can run alongside the original.

## Verification and packaging

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run prepare:standalone
npm run dist
npm run release
```

`npm test` runs the deterministic service suite. `npm run test:e2e` builds a packaged Electron directory and runs the production-browser and packaged-desktop workflows against disposable data.

The normal test suite verifies the reviewed Palworld template’s checksum, setting coverage, and codecs. When updating the template after a game release, review its diff and update both fixture files together; the provenance record includes the game version, Steam build ID, capture date, and checksum.

`npm run dist` builds the Linux AppImage and the Windows Setup and portable exes together (the Windows builds are cross-built through Wine, in a throwaway prefix). `npm run release` runs every check first, then builds them into a clean `release/` with `SHA256SUMS.txt`. `dist:linux` and `dist:windows` build one platform for quick local testing.

See the [release process](./docs/RELEASING.md) for publishing releases with the Generate release workflow, alpha versioning, migration safety, and manual AppImage updates.

## Documentation

- [Language-pack format](./docs/LANGUAGE-PACKS.md)
- [Privacy policy](./PRIVACY.md)
