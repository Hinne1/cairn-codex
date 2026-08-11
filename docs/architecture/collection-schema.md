# Collection persistence schema

Cairn Codex uses Electron's bundled Node SQLite module. The main process owns
the database; neither the renderer nor the Grim Dawn helper opens it.

The first schema deliberately separates four concepts:

- catalog_item is one canonical, browsable Epic or Legendary base record.
- collection_entry is lifetime discovery state. It survives when no copy is
  currently visible in a stash.
- scan_run, stash_snapshot, and observed_item are immutable evidence of what a
  read-only scan saw, including source hashes, serialized roll inputs, and the
  trusted/withheld seed-stat analysis produced for each eligible copy.
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

Schema version 3 adds `observed_item.roll_json`. This preserves the complete
per-copy audit payload—seed, sampled extrema, per-stat estimated percentiles,
sample size, and any unmodeled fields—alongside the scan that produced it.
Catalog tiles receive the best trusted score and analyzed-copy count from the
current snapshot; lifetime discovery remains independent of current
availability and roll scoring.

Schema version 4 adds a location-independent SHA-256 fingerprint to observed
copies and a `pinned_best` table keyed by canonical catalog record. The
fingerprint covers serialized item identity and roll fields but excludes stash
path, tab, item index, and coordinates, so a preference survives ordinary item
movement. Auto-best remains computed data; pinned-best is explicit user state
and may intentionally select a lower aggregate score.

Schema version 5 separates lifetime discovery, pinned choices, and Vault items
by Hardcore/Softcore mode. A retrieval cannot cross that boundary.

The UI exposes two projections over the same canonical catalog:

- **Stash Scanner** uses selected stash snapshots for physical availability and
  mode-specific lifetime discoveries for completion.
- **Codex Archive** uses `vault_item` as the ownership authority. Ingested
  rows are available copies; retrieved rows remain historical discoveries but
  are no longer available. Consequently an item can leave every Grim Dawn
  stash while remaining both serialized and browsable in Cairn Codex.
