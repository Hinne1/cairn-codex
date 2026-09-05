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

Schema version 9 adds reusable supply rows for faction writs/mandates and
equipment augments/movement runes. These remain ordinary journaled `vault_item`
payloads, but retrieval normalizes the emitted stack to one and returns a
verified reusable row to `ingested` instead of consuming it. Supply catalog
records are excluded from equipment roll analysis and equipment completion;
their own summary tracks lifetime supply unlocks separately.

Schema version 10 persists the `infinite_supplies` behavior setting. Disabling
it clears the reusable flag on stored supply rows, so their next verified
retrieval advances to `retrieved` normally. Re-enabling it marks only supplies
that are still `ingested` as reusable and never resurrects a consumed row.

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

Roll model v9 extends the JSON audit payload with grouped offense-by-damage,
specialist retaliation, defense, utility, and conditional pet scores. Elemental
rolls feed Fire, Cold, and Lightning lanes when those lanes exist. Each category stores both the
average range-normalized `qualityPercent` (0% minimum, 100% maximum) and that average's percentile rank
among sampled combinations for the same item template. Old rows remain valid
JSON, but the background hydrator treats every earlier model version as stale
and re-analyzes it in bounded batches. Catalog tiles, copy comparison, and MI
Workshop consume the category profile; activating a catalog score opens the
physical copy that produced it. MI labels explicitly note that exact-template
roll quality does not judge affix suitability. The legacy overall value remains
stored for backward-compatible audit payloads and explicitly labeled legacy metrics.
Per-stat and category marginal percentile fields are retained separately; they
must never be displayed as range quality. Old category scores without
`qualityPercent` are withheld until rehydrated. Old trusted per-stat values can be
normalized safely from their retained sampled extrema without relabeling a rank.

Schema version 4 adds a location-independent SHA-256 fingerprint to observed
copies and a `pinned_best` table keyed by canonical catalog record. The
fingerprint covers serialized item identity and roll fields but excludes stash
path, tab, item index, and coordinates, so a preference survives ordinary item
movement. Auto-best remains computed data; pinned-best is explicit user state
and may intentionally select a lower aggregate score.

Schema version 5 separates lifetime discovery, pinned choices, and Vault items
by Hardcore/Softcore mode. A retrieval cannot cross that boundary.

Schema version 13 restores recovery attention for the narrowly identified legacy
live-ingest failures whose error handler discarded adapter metadata. It requires
the deterministic live operation ID, live SC/HC stash identity, source SHA-256,
one matching pending payload and absence of its stored vault copy. The migration
preserves the payload and error, marks the operation `needs_recovery`, and restores
its live adapter marker. Ordinary offline failures and malformed identities remain
unchanged. Resuming still requires the polled incoming source to match every
persisted payload field and its original mode; reopening is idempotent.

Schema version 14 adds `vault_item_projection`, a derived metadata table for bounded Supplies and
Dismantling queries. A transactional backfill and insert/payload-or-roll-update triggers project
seed, stack count, attachment/affix records and numeric roll percentile without changing exact
`serialized_item` or `roll_json` bytes. Malformed legacy payloads remain stored and are excluded
from these queries, including integers outside JavaScript's safe range; malformed roll metadata
becomes an absent score. Row state, mode, reusable
status and catalog identity are joined from their authoritative tables on every query. The
projection is removed with its vault row. Page and preview metadata lookups never read exact
payload columns; migrations and authoritative transfer operations retain their existing ownership.

The UI exposes two projections over the same canonical catalog:

- **Stash Scanner** uses selected stash snapshots for physical availability and
  mode-specific lifetime discoveries for completion.
- **Codex Archive** uses `vault_item` as the ownership authority. Ingested
  rows are available copies; retrieved rows remain historical discoveries but
  are no longer available. Consequently an item can leave every Grim Dawn
  stash while remaining both serialized and browsable in Cairn Codex.

## Offline snapshot cache

The main process also keeps the latest complete collection projection in a
versioned, atomically replaced `collection-snapshot.json` envelope. A stale map
index or temporarily unavailable save source never makes that durable snapshot
unreadable: the renderer receives it with `cacheNeedsRefresh` and shows the
oldest retained source timestamp until a refresh succeeds. Legacy unversioned
snapshots are accepted once and upgraded on the next successful write; unknown
versions, failed integrity hashes, and malformed shapes fail closed. A
structurally compatible older catalog presentation remains browseable as stale
data while a compatible rescan is attempted, and remains available to
reconcile durable source and recipe knowledge afterward.

Refresh reconciliation is source-aware. A prior stash or account store remains
cached until a new scan positively contains that exact source. Consequently,
mere disappearance never means zero, while a successfully scanned source with
zero entries does replace the previous quantity. Known blueprint flags are
monotonic learned-account facts, so a later partial formula view cannot revoke
a recipe Cairn already observed.
