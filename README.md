# Palworld Server Manager — Next

Clean Next.js 16 and Electron rewrite focused on reliable management of multiple Palworld dedicated servers. The original application remains the behavioral reference; this branch does not preserve its internal architecture.

See [CORE-CAPABILITY-MATRIX.md](./CORE-CAPABILITY-MATRIX.md) for the end-to-end acceptance checklist and current verified status.

## Requirements

- Node.js 24 (`.nvmrc`)
- npm 11+
- Linux is the first packaging target

The current machine has Node installed by the Fish `nvm` package at `/home/samuel/.local/share/nvm/v24.21.0`. Zsh does not currently activate that manager automatically, so either configure Zsh or prepend that `bin` directory to `PATH`.

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
- English is the protected fallback language. Additional PSM Next JSON packs can be installed from Application Settings and are stored under the manager data directory; incomplete packs fall back to English. See [LANGUAGE-PACKS.md](./LANGUAGE-PACKS.md) for the pack format.

Create a disposable development sandbox with explicit paths:

```bash
npm run clone:dev-data -- \
  --source-db /path/to/registry.sqlite \
  --destination /data/Projects/psm-next-sandbox \
  --world family=/data/Projects/palworld-server-manager/family \
  --world valhilworld1=/data/Projects/palworld-server-manager/valhilworld1
```

The command refuses existing or overlapping destinations, uses SQLite's backup API, resets runtime state, and disables schedules and external integrations in the copied database.

## Verification and packaging

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run prepare:standalone
npm run dist:linux
```

The existing AppImage must remain installed until copied-server lifecycle, migration, and RDP rendering acceptance tests pass.
