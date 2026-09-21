# Core capability matrix

This is the release checklist for the Next.js rewrite. An item is checked only
after it works end-to-end through the packaged AppImage against the isolated
copies in `/data/Projects/psm-next-sandbox`. Code that exists but has not passed
that test remains unchecked and is labelled **Partial**.

A section is complete only when every item in that section is checked. The
heading explicitly states **Complete** or **Incomplete** so a collection of
foundational checkmarks cannot be mistaken for full feature parity.

The original worlds are out of scope until every item in **Production cutover
gate** is checked.

## World registry and isolation — Complete

- [x] Import both legacy worlds with stable IDs and core settings
- [x] Keep copied world paths separate from the original installations
- [x] Reject overlapping installation directories
- [x] Detect port conflicts between registered worlds
- [x] Register a new Linux or Windows/Wine world
- [x] Edit every manager registration property in the World properties UI
- [x] Adopt an existing installation with an explicit selection flow
- [x] Remove a registration with confirmation without deleting server files
- [x] Keep jobs, logs, backups, and configuration records isolated by world
- [x] Import/export a portable world registration

## Workflow alignment — Complete

- [x] Document the original-to-rewrite workflow map
- [x] Fleet list uses the original Start/Stop/Manage hierarchy
- [x] Dedicated per-world workspace with a persistent status header
- [x] Core tabs follow Overview, Players, Console, Server config, Backups, Schedule, World properties
- [x] Operations/download progress has a dedicated navigation destination

## Installation and updates — Complete

- [x] Keep rewrite SteamCMD data separate from game installations
- [x] Construct Linux and Windows/Wine SteamCMD installs without a shell
- [x] Redact configured Steam credentials from operation output
- [x] Prevent overlapping operations on one world
- [x] Display persistent SteamCMD output and progress in the UI
- [x] Update copied world 1 and preserve saves/configuration
- [x] Update copied world 2 and preserve saves/configuration
- [x] Run safe concurrent operations across different worlds
- [x] Detect the available Palworld build before an update
- [x] Cancel a running install/update safely

## Process lifecycle — Complete

- [x] Start a copied Linux server from the packaged manager stack
- [x] Stop through REST save plus graceful shutdown
- [x] Preserve `PalWorldSettings.ini` across graceful shutdown
- [x] Force-stop fallback for an unresponsive process tree
- [x] Reject a duplicate operation for the same world
- [x] Start and operate both copied worlds simultaneously
- [x] Reconcile running processes after manager restart
- [x] Recover a deliberately crashed copied server
- [x] Verify autostart after reboot/login — **Confirmed after a full KDE login reboot: the manager started hidden, launched only copied world 1, and accepted a Palworld client connection**
- [x] Keep servers running while the UI is hidden to the tray
- [x] Prevent two desktop manager instances
- [x] Confirmed bulk start/stop/restart controls

## Configuration — Complete

- [x] Load the correct Linux/Windows `PalWorldSettings.ini`
- [x] Raw editor with size, NUL, quote, and parenthesis validation
- [x] Atomic configuration writes
- [x] Snapshot before edit and retain saved versions
- [x] Restore a historical configuration version
- [x] Schema-driven guided editor for all 107 settings defined by the original manager
- [x] Original numeric limits, select choices, and server-side validation for guided settings
- [x] Grouped setting categories with descriptions, tooltips, and field/key search
- [x] Configuration presets with review-before-save behavior
- [x] Per-field default indicators, validation hints, and revert controls
- [x] Synchronize managed ports/passwords/REST/RCON values into the INI
- [x] Show a clear restart-required state after changes and clear it after restart
- [x] Portable configuration ZIP import/export with byte-for-byte round-trip verification

## Backups, restores, and scheduling — Complete

The Backups and Schedule tabs are tracked together because scheduled backups,
maintenance windows, safety backups, and restore readiness share the same
persistent runtime. The current Schedule tab is intentionally partial compared
with the original manager.

**Backups and restores**

- [x] Import and validate all four copied legacy backup archives
- [x] Create a ZIP from a copied world's `Saved` directory
- [x] Reject corrupt archives and unsafe extraction paths
- [x] Require a stopped world before restore
- [x] Create a pre-restore safety backup
- [x] Perform and verify a destructive restore on copied world 1
- [x] Perform and verify a destructive restore on copied world 2
- [x] Backup retention rules
- [x] Custom backup destinations with installation-overlap protection
- [x] Backup deletion/download controls in the UI

**Schedule tab and runtime**

- [x] Import legacy schedule definitions in a disabled state
- [x] Schedule editor and validation for all original manager action and timing types
- [x] Scheduled backups
- [x] Skip-next-run control for supported schedules
- [x] Enable, disable, and delete controls verified end to end
- [x] Scheduled graceful restarts with configurable player warnings and safety backups
- [x] Scheduled graceful stops with configurable player warnings and safety backups
- [x] Scheduled updates with warnings, backup, update, and prior-state restoration
- [x] Scheduled system messages and on-screen notices with REST fallback
- [x] Player-join message triggers with player filter, delay, and `{player}` substitution
- [x] Stop-when-empty schedules using REST player presence
- [x] Custom HTTP schedules with method, URL, headers, body, timeout, and protocol validation
- [x] Minute/hour intervals and daily local-time schedules matching the original controls
- [x] Last-run and next-run visibility with persistent operation history
- [x] Restart-safe next-run calculation, including overdue jobs and local-time changes

## Operations and observability — Complete

- [x] Persistent asynchronous job records
- [x] Consolidated SSE world/job event stream
- [x] Persistent command output per job
- [x] Live server log viewer with pause, search, file selection, and authenticated full-log download
- [x] Persistent event-history screen
- [x] REST server information and health
- [x] Live player list and session history
- [x] Server metrics display
- [x] Persisted death-history screen and imported-record rendering
- [x] Announce, save, ban, and unban controls through Palworld's local REST API — **A live ban disconnected the player and blocked reconnection; unban restored access and the player reconnected successfully**
- [x] Kick a connected player — **The packaged control successfully kicked a live player and the REST player list reflected the disconnect within one second**
- [x] Legacy RCON console for explicitly enabled worlds, including a successful packaged `Info` command against copied world 2

## Desktop and packaging — Incomplete

- [x] Typed Electron main/preload build
- [x] Linux `--disable-dev-shm-usage` compatibility
- [x] Guarded sandbox/zygote compatibility
- [x] Startup and renderer-crash diagnostics
- [x] AppImage contains and starts the standalone Next.js server
- [x] Stable `psm-next.AppImage` artifact name
- [x] Single-instance lock and tray support
- [x] User-confirmed rendering through the KDE/RDP session
- [x] Directory picker wired into world forms
- [x] Desktop setting for close-to-tray behavior
- [x] Desktop setting for launch-at-login behavior
- [x] Validated login-launch checkboxes and custom Electron/Chromium flags with isolated autostart-file generation
- [ ] LAN binding and manager-port configuration

## Migration and safety — Complete

- [x] Read the legacy database without modifying it
- [x] Preserve a complete legacy snapshot for deferred integrations
- [x] Import worlds, events, backups, sessions, config history, mods, and app settings
- [x] Verify row counts, relationships, required fields, and SQLite integrity
- [x] Copy server trees, manager backups, logs, SteamCMD, and language data
- [x] Disable copied autostart, schedules, webhooks, bots, codes, and sessions
- [x] Rewrite copied paths and reject source/destination overlap
- [x] Keep the production legacy database untouched
- [x] Automated source-tree no-write guard during integration tests — **Reads protected paths from the original database and compares path/type/size/mtime/ctime/link metadata before and after the command**
- [x] Repeatable final production import and rollback rehearsal — **Imported both worlds from the untouched legacy database into a fresh candidate, validated it, activated it by same-filesystem rename, and restored the known-good database byte for byte**

## Remote administration and localization — Incomplete

- [ ] Authenticated remote administration
- [ ] Scoped remote permissions and audit history
- [ ] Configurable LAN bind address and port
- [ ] Remote-session revocation
- [ ] Existing language-pack discovery
- [ ] UI localization

## Automated verification — Incomplete

- [x] Unit tests for path overlap, argument parsing, ports, and launch flags
- [x] Legacy importer fixture test with source immutability
- [x] TypeScript, ESLint, Vitest, Next production build, and Electron build
- [x] Browser smoke test against both imported copied worlds
- [ ] Unit tests for state machines, retention, schedules, and INI transformations — **Partial: schedules and quote/tuple-safe INI transformations are covered**
- [ ] Fake SteamCMD/process/REST/RCON/filesystem adapter tests
- [ ] Playwright workflows for all critical management operations
- [ ] Packaged Electron workflow tests

## Production cutover gate — Blocked

- [ ] Both copies independently pass update, configure, start, monitor, stop, restart, backup, and restore
- [x] Both copies operate simultaneously and port-conflict handling is demonstrated
- [ ] Scheduling, recovery, autostart, tray, and restart reconciliation pass
- [ ] Remote administration and authentication pass
- [x] Packaged AppImage renders reliably in the actual KDE/RDP session
- [ ] No original server-directory writes occurred during development
- [x] Production import rehearsal and rollback rehearsal pass
- [ ] User approves replacing the known-good AppImage

## Post-core administrator guidance — Enhancement backlog

This section improves usability but does not block the core-management release.
The research and presentation standard is defined in
[`PALWORLD-SETTINGS-REFERENCE.md`](PALWORLD-SETTINGS-REFERENCE.md).

- [ ] Document all 107 guided settings with a plain-language purpose and cited source
- [ ] Record the verified default, unit, choices, and minimum/maximum where a source establishes them
- [ ] Explain what increasing and decreasing every numeric setting does
- [ ] Document performance costs, destructive effects, dependencies, deprecations, and restart requirements
- [ ] Label each claim as official, shipped-default, verified-by-test, community-sourced, or unknown
- [ ] Replace terse field hints with concise administrator-facing help derived from the reference
- [ ] Provide expanded in-app help with source links for every guided setting
- [ ] Add an automated coverage check so no schema setting can lack a reference entry
- [ ] Review reference data when the dedicated-server build adds or changes settings

## Deferred integrations and extensions — Deferred

These do not block the core release and must not be presented as available.

**Mods and operational extensions**

- [x] Preserve legacy mod records during migration for later implementation
- [ ] PSM Death Relay installation and live death-file capture
- [ ] Scan and display installed mods
- [ ] Enable/disable mods safely
- [ ] Install/update/remove supported mods
- [ ] UE4SS installation and validation
- [ ] Login rewards management
- [ ] Preserve mods through SteamCMD updates

**Community integrations**

- [ ] Discord webhooks, bots, commands, templates, and auditing
- [ ] Map rendering and PalSchema visualization
- [ ] Remaining social/community integrations
