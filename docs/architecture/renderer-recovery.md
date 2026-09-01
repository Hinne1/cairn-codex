# Renderer recovery and safe mode

Cairn Codex treats renderer state as disposable and the Codex Archive as durable. A broken
workspace or preference must never imply that collection data, operation journals, backups,
Grim Dawn saves, or stashes should be reset.

## Failure surfaces

Vue descendant failures are converted into a bounded `RendererErrorReport`. The report contains
only a generated correlation ID, the active workspace name, a bounded error message, and a
bounded stack. It crosses the typed preload boundary and is written to rotating diagnostics.
Item payloads and character names are not added to the report.

The workspace recovery surface leaves the application shell available and offers four explicit
actions:

- retry the failed workspace;
- return to Collection;
- restart in safe mode; or
- export redacted diagnostics.

An error that occurs before the workspace boundary exists falls back to a static root recovery
surface. That surface uses text nodes for failure details, so an exception message cannot inject
markup.

## Crash-loop detection

`StartupRecoveryService` keeps a small versioned JSON checkpoint in Electron's user-data
directory. A launch becomes healthy only after the renderer reports its interactive startup
phase. On the next launch, an earlier unhealthy start counts as a failure only when it occurred
inside the bounded ten-minute window.

After three consecutive failed starts, the next launch offers safe mode. A healthy launch resets
the counter. Corrupt or missing checkpoint data is treated as a fresh start; it never blocks the
application.

## Safe mode

Safe mode is a process launch mode, not a database mode. It:

- disables and hides experimental workspaces;
- pauses automatic Grim Dawn connection; and
- suppresses first-run onboarding so recovery controls remain reachable.

Manual browsing, Settings, Transfers, diagnostics, backups, and the archive remain available.
The user can restart normally at any time.

## Interface preference reset

The reset action uses an explicit allowlist in `renderer-recovery.ts`. It removes only display and
workspace preferences such as zoom, visible tools, tracker layout, selected Skill Explorer scope,
Oracle controls, planner display mode, and MI counting presentation.

It deliberately preserves:

- the Codex Archive and every database-backed journal;
- planner profiles, selected skills, favorites, and ignored items;
- the in-app to-do list;
- collection source and mode selection;
- retrieval target and automatic live-connection preference;
- onboarding progress; and
- every save, stash, archive backup, and Item Assistant source.

New resettable preferences must be added to the allowlist deliberately. New durable user state
must never be added to that allowlist.

## Verification

`npm run test:safe-mode` covers bounded failure counting, stale-window reset, healthy reset,
safe-mode suggestion rules, diagnostic correlation IDs, and the preference preservation list.
The isolated screenshot harness supports `--simulate-workspace-error`, `--safe-mode`, and
`--safe-mode-suggested` for normal and narrow-window visual checks.
