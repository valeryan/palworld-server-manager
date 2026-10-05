# Running on Windows

Use Windows 11 x64 with writable local NTFS storage. Network/UNC locations, ARM64, WSL execution and running the manager as a Windows service are not supported.

## Installation and data

**Setup** installs for the current user and stores manager data in the user profile. **Portable** stores `PSM-Data` beside the outer EXE. Keep that folder when replacing the Portable executable.

World folders are separate from manager data and use absolute paths. Moving Portable and `PSM-Data` does not move worlds or update their registered paths. Another local NTFS volume is supported.

Both formats support launch at login. Windows Startup settings can disable an entry independently of the manager preference; check the displayed startup state if the application stops opening at login. Launch at login requires a user session; it is not a service at boot.

## Installation failures and repair

A failed installation keeps its registration and operation history. Open **Operations** for the error, use **Settings → Server Admin** to correct the name, path, platform or launch preferences, then choose **Retry installation**. Game settings require the installed configuration template.

SteamCMD runs one installation or update at a time; other requests wait in the queue. Interrupted work is checked before retry. If an existing worker or uncertain process ownership blocks an operation, inspect the reported error before retrying.

Use **Remove from manager** on Overview or in Server Admin to unregister a world. Stop its server and finish or cancel active operations first. Removal preserves server files and saves.

Prerequisite repair checks the Visual C++ x64 runtime and uses the game's signed bundled installer or Microsoft's signed redistributable. Only the installer requests administrator approval. Once started, its installation cannot be cancelled through the manager. Follow any reboot-required message before starting the server.

## Servers and logs

Start runs the server without a separate console window. Read its output in the world's **Console** tab. Some messages may be buffered by the game. If the required server executable is missing, repair the installation before starting it.

An intentional Stop cancels pending crash recovery. Unexpected process termination can trigger recovery when enabled.

Quit waits for active operations and leaves game servers running. Reopening the manager reconnects to them. Schedules and crash recovery operate only while the manager is open. Windows logout or shutdown can terminate servers.

## Updating the manager

Updates require manual replacement:

1. Download the matching artifact and compare its SHA-256 with the digest shown on the GitHub release.
2. Quit the manager and wait for active operations to finish.
3. For Setup, run the new installer. For Portable, replace the outer EXE and retain `PSM-Data`.
4. Open the new version. This also refreshes an already-enabled login entry after a move or replacement.

Keep the previous executable until the new version starts successfully. Startup backs up the database before migrations; follow its recovery diagnostics if an upgrade fails. Do not open a newer database with an incompatible older version.

Windows builds are unsigned and may display SmartScreen prompts. Automatic download/install/restart updates are not available.

## References

- [Palworld dedicated-server deployment](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/)
- [Microsoft Visual C++ runtime downloads](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)
