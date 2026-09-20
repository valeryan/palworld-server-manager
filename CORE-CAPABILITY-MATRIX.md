# Core capability matrix

This is the release checklist for the Next.js rewrite. An item is checked only
after it works end-to-end through the packaged AppImage against the isolated
copies in `/data/Projects/psm-next-sandbox`. Code that exists but has not passed
that test remains unchecked and is labelled **Partial**.

The original worlds are out of scope until every item in **Production cutover
gate** is checked.

## World registry and isolation

- [x] Import both legacy worlds with stable IDs and core settings
- [x] Keep copied world paths separate from the original installations
- [x] Reject overlapping installation directories
- [x] Detect port conflicts between registered worlds
- [x] Register a new Linux or Windows/Wine world
- [ ] Edit every world property in the UI — **Partial: API exists; UI is incomplete**
- [x] Adopt an existing installation with an explicit selection flow
- [x] Remove a registration with confirmation without deleting server files
- [x] Keep jobs, logs, backups, and configuration records isolated by world
- [ ] Import/export a portable world registration

## Workflow alignment

- [x] Document the original-to-rewrite workflow map
- [x] Fleet list uses the original Start/Stop/Manage hierarchy
- [x] Dedicated per-world workspace with a persistent status header
- [x] Core tabs follow Overview, Players, Console, Settings, Backups, Schedule, Admin
- [x] Operations/download progress has a dedicated navigation destination

## Installation and updates

- [x] Keep rewrite SteamCMD data separate from game installations
- [x] Construct Linux and Windows/Wine SteamCMD installs without a shell
- [x] Redact configured Steam credentials from operation output
- [x] Prevent overlapping operations on one world
- [x] Display persistent SteamCMD output and progress in the UI
- [x] Update copied world 1 and preserve saves/configuration
- [x] Update copied world 2 and preserve saves/configuration
- [x] Run safe concurrent operations across different worlds
- [ ] Detect the available Palworld build before an update
- [ ] Cancel a running install/update safely

## Process lifecycle

- [x] Start a copied Linux server from the packaged manager stack
- [x] Stop through REST save plus graceful shutdown
- [x] Preserve `PalWorldSettings.ini` across graceful shutdown
- [x] Force-stop fallback for an unresponsive process tree
- [x] Reject a duplicate operation for the same world
- [x] Start and operate both copied worlds simultaneously
- [x] Reconcile running processes after manager restart
- [ ] Recover a deliberately crashed copied server
- [ ] Verify autostart after reboot/login
- [ ] Keep servers running while the UI is hidden to the tray
- [x] Prevent two desktop manager instances
- [ ] Confirmed bulk start/stop/restart controls

## Configuration

- [x] Load the correct Linux/Windows `PalWorldSettings.ini`
- [x] Raw editor with size, NUL, quote, and parenthesis validation
- [x] Atomic configuration writes
- [x] Snapshot before edit and retain saved versions
- [x] Restore a historical configuration version
- [ ] Structured editor for common Palworld settings
- [ ] Synchronize managed ports/passwords/REST/RCON values into the INI
- [ ] Show a clear restart-required state after changes
- [ ] Portable configuration import/export

## Backups and restores

- [x] Import and validate all four copied legacy backup archives
- [x] Create a ZIP from a copied world's `Saved` directory
- [x] Reject corrupt archives and unsafe extraction paths
- [x] Require a stopped world before restore
- [x] Create a pre-restore safety backup
- [x] Perform and verify a destructive restore on copied world 1
- [x] Perform and verify a destructive restore on copied world 2
- [ ] Backup retention rules
- [ ] Custom backup destinations
- [ ] Backup deletion/download controls in the UI

## Operations and observability

- [x] Persistent asynchronous job records
- [x] Consolidated SSE world/job event stream
- [x] Persistent command output per job
- [ ] Live server log viewer with pause/search/download — **Partial: live tail and refresh are packaged**
- [x] Persistent event-history screen
- [x] REST server information and health
- [x] Live player list and session history
- [x] Server metrics display
- [ ] Death history
- [ ] Announce, save, kick, ban, and unban controls
- [ ] Legacy RCON console for explicitly enabled worlds

## Scheduling

- [x] Import legacy schedule definitions in a disabled state
- [x] Schedule editor and validation for backups and restarts
- [x] Scheduled backups
- [ ] Scheduled restarts with warnings
- [ ] Scheduled updates
- [ ] Scheduled messages and join-triggered notices
- [x] Skip-next-run control
- [ ] Restart-safe next-run calculation

## Mods and operational components

- [x] Preserve legacy mod records during migration
- [ ] Scan and display installed mods
- [ ] Enable/disable mods safely
- [ ] Install/update/remove supported mods
- [ ] UE4SS installation and validation
- [ ] Login rewards management
- [ ] Preserve mods through SteamCMD updates

## Desktop and packaging

- [x] Typed Electron main/preload build
- [x] Linux `--disable-dev-shm-usage` compatibility
- [x] Guarded sandbox/zygote compatibility
- [x] Startup and renderer-crash diagnostics
- [x] AppImage contains and starts the standalone Next.js server
- [x] Stable `psm-next.AppImage` artifact name
- [x] Single-instance lock and tray support
- [x] User-confirmed rendering through the KDE/RDP session
- [ ] Directory picker wired into world forms
- [x] Desktop setting for close-to-tray behavior
- [ ] Desktop setting for launch-at-login behavior
- [ ] LAN binding and manager-port configuration

## Migration and safety

- [x] Read the legacy database without modifying it
- [x] Preserve a complete legacy snapshot for deferred integrations
- [x] Import worlds, events, backups, sessions, config history, mods, and app settings
- [x] Verify row counts, relationships, required fields, and SQLite integrity
- [x] Copy server trees, manager backups, logs, SteamCMD, and language data
- [x] Disable copied autostart, schedules, webhooks, bots, codes, and sessions
- [x] Rewrite copied paths and reject source/destination overlap
- [x] Keep the production legacy database untouched
- [ ] Automated source-tree no-write guard during integration tests
- [ ] Repeatable final production import and rollback rehearsal

## Remote administration and localization

- [ ] Authenticated remote administration
- [ ] Scoped remote permissions and audit history
- [ ] Configurable LAN bind address and port
- [ ] Remote-session revocation
- [ ] Existing language-pack discovery
- [ ] UI localization

## Automated verification

- [x] Unit tests for path overlap, argument parsing, ports, and launch flags
- [x] Legacy importer fixture test with source immutability
- [x] TypeScript, ESLint, Vitest, Next production build, and Electron build
- [x] Browser smoke test against both imported copied worlds
- [ ] Unit tests for state machines, retention, schedules, and INI transformations
- [ ] Fake SteamCMD/process/REST/RCON/filesystem adapter tests
- [ ] Playwright workflows for all critical management operations
- [ ] Packaged Electron workflow tests

## Production cutover gate

- [ ] Both copies independently pass update, configure, start, monitor, stop, restart, backup, and restore
- [x] Both copies operate simultaneously and port-conflict handling is demonstrated
- [ ] Scheduling, recovery, autostart, tray, and restart reconciliation pass
- [ ] Remote administration and authentication pass
- [ ] Packaged AppImage renders reliably in the actual KDE/RDP session
- [ ] No original server-directory writes occurred during development
- [ ] Production import rehearsal and rollback rehearsal pass
- [ ] User approves replacing the known-good AppImage

## Deferred integrations

These do not block the core release and must not be presented as available.

- [ ] Discord webhooks, bots, commands, templates, and auditing
- [ ] Map rendering and PalSchema visualization
- [ ] Remaining social/community integrations
