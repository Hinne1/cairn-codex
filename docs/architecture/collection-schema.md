# Collection persistence schema

Cairn Codex uses Electron's bundled Node SQLite module. The main process owns
the database; neither the renderer nor the Grim Dawn helper opens it.

The first schema deliberately separates four concepts:

- catalog_item is one canonical, browsable Epic or Legendary base record.
- collection_entry is lifetime discovery state. It survives when no copy is
  currently visible in a stash.
- scan_run, stash_snapshot, and observed_item are immutable evidence of what a
  read-only scan saw, including source hashes and roll-relevant item fields.
- vault_item is a future app-owned serialized item. It is not a generic stash:
  its state is restricted to the ingest/retrieval lifecycle.

operation_journal is reserved now so write milestones cannot bypass the
backup/hash/verification state machine later.

Each collection scan is persisted in one immediate transaction. Catalog
metadata is upserted, scan evidence is appended, and collection_entry rows are
inserted or last-seen timestamps advanced. A missing currently available copy
never deletes its lifetime collection entry.

SQLite foreign keys, STRICT tables, full synchronous writes, and WAL mode are
enabled. The desktop smoke test uses an isolated in-memory database and verifies
that discoveries remain after a synthetic subsequent scan with zero available
copies.
