# Palworld Server Manager — Next

Clean Next.js 16 and Electron rewrite focused on reliable management of multiple Palworld dedicated servers. The original application remains the behavioral reference; this branch does not preserve its internal architecture.

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

Development uses port `4318` and `.data-next`, intentionally separate from the current manager's database and port.

## Safety model

- The new registry is `registry-v3.sqlite`; the legacy `registry.sqlite` is only opened read-only by the importer.
- A registered world may not share or nest its installation directory with another world.
- Ports must be unique within and across worlds.
- Operations are serialized per world and represented as persistent jobs.
- Persistent operation, activity, server-log, and configuration history has configurable age/count retention in Application Settings; active operations are never removed.
- Backups are verified before use, restores require a stopped server, and restores create a pre-restore backup.
- API responses never include server passwords, admin passwords, or process environment variables.
- English is the protected fallback language. Additional PSM Next JSON packs can be installed from Application Settings and are stored under the manager data directory; incomplete packs fall back to English. See [language packs](./docs/LANGUAGE-PACKS.md) for the pack format.

Create a disposable development sandbox with explicit paths:

```bash
npm run clone:dev-data -- \
  --source-db /path/to/registry.sqlite \
  --destination /path/to/psm-next-sandbox \
  --world family=/path/to/original/family \
  --world valhilworld1=/path/to/original/valhilworld1
```

The command refuses existing or overlapping destinations, uses SQLite's backup API, resets runtime state, and disables schedules and external integrations in the copied database.

## Verification and packaging

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run prepare:standalone
npm run dist:linux
```

`npm test` runs the deterministic service suite. `npm run test:e2e` builds a packaged Electron directory and runs the production-browser and packaged-desktop workflows against disposable data.

## Documentation

- [Language-pack format](./docs/LANGUAGE-PACKS.md)
- [Privacy policy](./PRIVACY.md)
