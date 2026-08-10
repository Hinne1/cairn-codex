# Collection persistence schema

Cairn Codex uses Electron's bundled Node SQLite module. The main process owns
the database; neither the renderer nor the Grim Dawn helper opens it.

The first schema deliberately separates four concepts:

- catalog_item is one canonical, browsable Epic or Legendary base record.
- collection_entry is lifetime discovery state. It survives when no copy is
  currently visible in a stash.
- scan_run, stash_snapshot, and observed_item are immutable evidence of what a
  read-only scan saw, including source hashes and roll-relevant item fields.
- vault_item is an app-owned serialized item. It is not a generic stash:
  its state is restricted to the ingest/retrieval lifecycle.

operation_journal records prepared, committed, failed, and recovery-required
ingest/retrieval operations so no write can bypass the backup/hash/verification
state machine. Pending ingest payloads are committed before the source item is
removed. Retrieval atomically advances selected vault items through
`ingested`, `retrieval_pending`, and `retrieved` states.

Each collection scan is persisted in one immediate transaction. Catalog
metadata is upserted, scan evidence is appended, and collection_entry rows are
inserted or last-seen timestamps advanced. A missing currently available copy
never deletes its lifetime collection entry.

SQLite foreign keys, STRICT tables, full synchronous writes, and WAL mode are
enabled. The desktop smoke test uses an isolated in-memory database and verifies
that discoveries remain after a synthetic subsequent scan with zero available
copies. It also exercises the complete ingest and retrieval journal state
transition without touching a real stash.
