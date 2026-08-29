# Transfer recovery

## First response

If Cairn reports a timeout, `needs_recovery`, an unresolved queue operation, or
an outcome that does not match the game:

1. Stop issuing transfers. Repeated clicks make evidence harder to interpret.
2. Close Grim Dawn and Cairn Codex normally if possible.
3. Copy `%APPDATA%\cairn-codex` to a separate safe directory.
4. Preserve the relevant Grim Dawn save directory. Do not overwrite it with an
   older cloud copy until the operation has been audited.
5. Reopen Cairn, go to Settings, export diagnostics, and open the data/backups
   folder. Do not post private save data publicly.

## Evidence Cairn retains

- `cairn-codex.sqlite3` and its WAL files contain archive state and the operation
  journal.
- `backups` contains verified pre-write transfer-stash snapshots for offline
  operations.
- `live-receipts` contains acknowledged live-ingest and live-return evidence.
- `live-adapter` contains incoming/outgoing queues and the native hook log.
- Quarantine directories retain unsupported or ambiguous queue records rather
  than deleting them.

An item is released from the archive only after its exact operation receives and
verifies the expected commit evidence. A helper timeout after a write request is
therefore treated as uncertain and retained for recovery, not casually rolled
back in the database.

## Offline stash restore

Do not choose a backup by timestamp alone. Match the operation identifier,
source hash, target stash, and journal entry first. With Grim Dawn and every
other stash tool closed, copy the current stash and the candidate backup to a
safe audit directory before replacing anything. Reparse the restored file before
starting the game.

The first public beta intentionally does not expose a one-click “restore latest”
button: restoring the wrong Hardcore/Softcore or cloud/local stash is more
dangerous than requiring a deliberate audit.
