# Windows runtime support (test builds)

The initial native acceptance target is Windows 11 x64. Develop and build on Linux; the release workflow cross-builds the Setup and Portable EXEs and then runs `scripts/artifact-tests/windows.mjs` on Windows. Wine checks are diagnostic and do not certify Windows functionality. The native process adapter requires Windows PowerShell/CIM; ordinary Wine prefixes may not provide it.

## Installation and data

Setup is per-user and stores manager data in Electron's user data directory. Portable stores `PSM-Data` beside the outer EXE. Use a writable local NTFS directory, including a different local volume. Network/UNC runtime locations and unverified extended-length paths are not supported. World paths are absolute: moving Portable and `PSM-Data` does not move or remap a world.

Both formats support launch at login; Portable registers the outer EXE. Windows Startup settings can disable an existing entry independently. The manager shows that state and does not enable startup without a saved preference. Logoff/reboot testing is a native acceptance gate.

## Operations and prerequisites

An incomplete installation remains registered. Settings → Server Admin can repair its name, path, platform and launch preferences even without a valid INI. Game settings wait for a shipped template or explicit configuration repair. Retry installation retains the registration and operation history. **Remove from manager** is available on the world Overview and in Server Admin. It preserves server files and saves; stop the server and finish or cancel active operations first.

SteamCMD is shared and serialized. Optional build-discovery failures do not block Valve installation. Windows bootstrap verifies the updated client again when its self-updater completes with exit 7; it requires a successful probe before installing game files. Retries are bounded and wait for staged workers to exit. Failed operations include the final error in retained output; interrupted work is reconciled before retry. A surviving worker or uncertain process owner blocks conflicting work.

Prerequisite diagnosis checks the registered Visual C++ x64 runtime; this is not an exhaustive dependency scan. Repair prefers the game's bundled signed Unreal installer, otherwise Microsoft's signed x64 redistributable. Only the installer requests elevation. Windows installer transactions cannot be cancelled through the manager once started. Respect any reboot-required result before starting the game.

Vendor references: [Palworld deployment](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/), [Microsoft runtime downloads](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170), [redistribution and installer options](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170).

## Server launch and console output

Native Windows launches the shipped `Pal/Binaries/Win64/PalServer-Win64-Shipping-Cmd.exe` directly with the same `Pal` argument used by the outer launcher. The current `PalServer.exe` bootstrap discards hidden-window and standard-output settings when creating its child. Direct launch keeps that game process detached, suppresses its console window, and sends stdout/stderr to the manager's server log. Installation health requires this binary; a missing binary requires repair instead of falling back to a visible console. Linux and Linux-hosted Wine retain their existing launch commands.

The manager adds Unreal's `-NoConsole`, `-stdout`, `-FullStdOutLogOutput`, and `-FORCELOGFLUSH` flags. Engine output is flushed to the Console tab's log file; game-specific output can still be buffered by the game. The real Windows server under Wine produced startup output immediately, but some REST access lines arrived in batches and one version line had an encoding defect. Native Windows logging latency and encoding remain acceptance checks.

Intentional Stop and process inspection share a per-world lifecycle lock. Stop cancels pending crash recovery, and delayed recovery rechecks the world before launching. An external console closure or external process termination still counts as an unexpected exit when crash recovery is enabled.

## Quit and replacement

Quit stops accepting work and waits for active jobs. Game servers keep running with file-backed logs. Schedules and crash recovery pause while the manager is closed; reopen reconnects by verified identity. Windows logout/shutdown is different and does not promise server survival.

Updates are manual in this milestone. Download the matching artifact from the selected GitHub release and compare its displayed SHA-256 digest. Quit and wait for operations to finish. For Setup, run the new installer; for Portable, replace the outer EXE while retaining `PSM-Data`, then launch the new EXE. Keep the previous binary until the new version starts successfully. Startup performs migration preflight and backup; follow its rollback diagnostics on failure. Do not open a newer database with an incompatible older version. Reopen a moved/replaced application once to refresh an already-enabled login entry.

Unsigned Windows artifacts may display SmartScreen prompts. Automatic updating, Windows development tooling, ARM64, WSL execution, and a Windows service at boot are outside this milestone.

## Acceptance

Native CI checks bootstrap, registration recovery, actual argv, fixture process survival and reattachment, backups/restores, startup targets and Setup reinstall. The user's Windows 11 pass still covers real game installation and updates, graceful shutdown, crash guard, Steam-library adoption, UAC/reboot, dialogs/tray/scaling, firewall/LAN, players, REST/RCON, deaths, mods, schedules and remote permissions. Do not label the milestone accepted until that pass is complete.
