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

## Planned boundary

The Electron process will talk to a small native host which owns injection,
queue directories, hook health, and game-state messages. The renderer will see
only a capability/status model and the same high-level Vault commands:

- `unavailable`: no compatible game process or hook binary;
- `connecting`: injector or handshake in progress;
- `ready`: compatible game, matching HC/SC mode, and queue handshake active;
- `blocked`: version mismatch, ambiguous mode, or hook failure.

Live ingest must durably store and verify an item before acknowledging its
removal. Live retrieval must not mark a Vault item retrieved until the hook has
acknowledged the in-game deposit. Every queue message needs an operation ID so
restarts and duplicate delivery remain idempotent.

The native hook is version-sensitive and must never be silently enabled. The
first implementation should be opt-in, report the detected game build and hook
version prominently, and retain the closed-game adapter as a fallback.
