# Live game adapter

The closed-game Vault transaction and live-game integration are intentionally
separate adapters behind the same ingest/retrieve operations.

## Closed-game adapter (implemented)

The current adapter edits `transfer.gst`/`transfer.gsh` only after the process
safety gate passes. It creates backup and rollback copies, writes a temporary
file, atomically replaces the source, reparses the result, and verifies hashes
and item-count invariants. This remains the recovery path even after live mode
is available.

## Item Assistant behavior

The live design was checked against Item Assistant upstream commit
`babced1cccd09c60ba0b36cf8c3cfe431910c754` (2026-08-10).

Current Item Assistant does not make live transfers by rewriting the stash file
behind Grim Dawn. `ItemAssistantHook_x64.dll` is injected into the game and
hooks inventory-sack operations. Items placed in the configured ingest tab are
serialized to an incoming queue and intercepted before normal storage. Items
requested by the UI are serialized to an outgoing queue and the hook deposits
them into the configured target tab in game memory.

That distinction matters: file watching can refresh a read-only collection,
but cannot make live mutation safe.

## Implemented opt-in boundary

The Electron process talks to the .NET helper, which owns a hidden
`GDIAWindowClass` handshake window, injection, queue directories, hook health,
and game-state messages. The renderer sees only a capability/status model and
the same high-level Vault commands:

- `unavailable`: no compatible game process or hook binary;
- `connecting`: injector or handshake in progress;
- `ready`: compatible game, matching HC/SC mode, and queue handshake active;
- `blocked`: version mismatch, ambiguous mode, or hook failure.

The adapter uses an app-owned hook built from the compatible MIT GDIA source and
reuses only the injector from the user's installed Item Assistant. Both the hook
and the running `Game.dll` must match an exact SHA-256 allowlist entry before
injection. Item Assistant must be closed while Cairn owns the window and queue.
Build provenance and the original crash fingerprint are documented in
[`docs/live-hook-compatibility.md`](../live-hook-compatibility.md).

Live ingest copies and SHA-256 verifies the hook's incoming CSV into Cairn's
receipt directory, commits the complete item payload and journal row to SQLite,
and only then acknowledges the incoming queue file. The operation and Vault IDs
are deterministic over the queue path and hash, so a failed acknowledgement is
safe to retry without creating another copy.

Live retrieval marks the selected Vault rows `retrieval_pending` before writing
operation-named outgoing CSV files. It waits for semantically matching files in
the hook's soft-delete directory and only then marks those rows `retrieved`.
Timeouts after queue delivery become `needs_recovery`, never an assumed failure.

On shutdown the helper destroys its handshake window and signals the hook's
named worker event. This forces the injected hook to observe the disconnect and
disable interception immediately.

The native hook is version-sensitive and is never silently enabled. The Vault
reports the detected hook version and configured ingest/deposit tabs, requires
an explicit confirmation for each game session, and retains the closed-game
adapter as a fallback. Unsupported live items are left in the durable incoming
queue and surfaced as a recovery issue rather than being discarded.
