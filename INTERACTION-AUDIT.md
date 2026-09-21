# Interaction and language audit

This completed audit checks whether an administrator can understand what the
manager is doing, what completed, what failed, and what action is safe to take
next. Capability-matrix progression resumed after the focused corrections.

All lifecycle tests in this audit use the copied worlds under
`/data/Projects/psm-next-sandbox`. They do not target the original server
directories.

## Packaged workflow walkthrough

- [x] Dashboard summary, world cards, bulk-action controls, and recent operations
- [x] Add-world dialog in both install and existing-server modes
- [x] Start a stopped copied world and verify transient feedback
- [x] Gracefully stop a running copied world and observe active and completed states
- [x] Restart a copied world and observe both phases and the completed state
- [x] Check the available Steam build and inspect its command output
- [x] Create and verify a backup from the Backups tab
- [x] Inspect restore availability and the stopped-world explanation
- [x] Inspect guided settings, raw configuration, and version history
- [x] Inspect player, overview, health, activity, and console states
- [x] Inspect schedule creation and maintenance-warning controls
- [x] Inspect World Properties at the packaged desktop viewport
- [x] Inspect operation-history filters and operation details
- [x] Inspect desktop settings and manager-owned path presentation
- [x] Verify the notification disappears without requiring a click
- [x] Verify the copied running world remains healthy after the walkthrough

Restore and full SteamCMD update behavior were destructively tested against
both copied worlds during their capability milestones. This pass reviews their
presentation and recorded results without repeating an unnecessary restore or
download.

## Corrected in this pass

- [x] Replace persistent page banners with dismissible, timed notifications
- [x] Replace generic `Operation queued` feedback with the requested action
- [x] Stop describing every running operation as `Starting`
- [x] Give lifecycle, backup, update, restore, and scheduled jobs readable names
- [x] Translate internal job states into Waiting, In progress, Completed, Failed, and Canceled
- [x] Keep an open operation dialog synchronized with the live job record
- [x] Show requested, started, and finished timestamps
- [x] Use a compact explanation when an operation has no command output
- [x] Show phase progress for start, graceful stop, restart, and build checks
- [x] Prevent transitional worlds from offering an incorrect Start action
- [x] Use readable operation-history filter labels
- [x] Humanize internal event and session identifiers
- [x] Align the World Properties tab heading and security explanation with its purpose

## Follow-up findings

These fit the existing capability milestones and should be addressed when the
related screen is developed rather than blocking this focused correction.

- [x] Add pause, search, and download controls to the live server log viewer
- [ ] Add explicit enabled/disabled badges to schedule records
- [ ] Distinguish error notifications visually and keep them visible longer than success notices
- [ ] Add inline explanations or tooltips to disabled actions where the reason is not already shown
- [ ] Replace native browser confirmations with consistent, descriptive confirmation dialogs
- [ ] Add automated packaged interaction coverage for transient and transitional UI states
