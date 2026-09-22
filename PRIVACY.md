# Privacy Policy

_Last updated: 21 September 2026_

Palworld Server Manager ("the app") is a desktop application you install and run on
your own computer to manage Palworld dedicated servers. Your privacy is simple to
explain because the app is designed to keep your data on your machine.

## What the app collects

**Nothing is collected by the developer.** The app has no analytics, no telemetry,
no accounts, and no "phone home" behaviour. The developer does not receive, store, or
have access to any of your data.

## Data stored on your computer

All data the app uses stays in local files on your own machine:

- Your list of worlds, operation history, schedules, remote-access records, and
  settings (a local database in your user-data folder).
- Each server's own game files, saves, and configuration, which remain in that
  server's install folder.
- Backups, server logs, language packs, and desktop preferences.

You can delete manager-owned data by removing the app's user-data folder. Server
installation folders are separate and should only be removed when you also intend to
delete those servers and their saves.

## Network connections the app makes

The app only contacts external services to perform the tasks you ask of it:

- **Valve / Steam distribution services:** SteamCMD downloads or updates the Palworld
  dedicated server from Valve's content network when you request an install or update.
- **steamcmd.net:** the manager queries its public app-info API when checking the
  latest available Palworld server build.
- **Your Palworld server's REST or RCON endpoint:** used on your own computer or local
  network to read status, save worlds, manage players, send messages, and shut down
  servers.
- **Administrator-configured HTTP endpoints:** a custom HTTP schedule sends the method,
  headers, and body entered by the administrator to the configured URL. This feature
  is not active unless such a schedule is created and enabled.
- **Remote administration clients:** if authenticated remote administration and LAN
  binding are enabled, devices that can reach the configured manager address may
  connect to it. Access requires a manager-issued code and is recorded in the local
  audit history.

The app makes no other outbound connections.

## Third-party services

Data sent to Valve, steamcmd.net, or an administrator-configured HTTP endpoint is
handled under that service's own privacy policy. The app does not send data to the
developer or sell it to any third party.

## Children's privacy

The app does not knowingly collect any personal information from anyone, including
children.

## Changes to this policy

If this policy changes, the updated version will be published in this repository with a
new "last updated" date.

## Contact

Questions about this policy can be raised through the repository's issue tracker.
