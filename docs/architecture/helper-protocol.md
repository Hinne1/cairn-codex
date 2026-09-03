# Grim Dawn helper protocol

The Electron main process starts `CairnCodex.GrimDawn` as a child process. Each
request and response is a single JSON object on its own line. Standard output is
reserved for protocol messages; diagnostics go to standard error.

## Envelope

Request:

```json
{"id":"1","method":"health","params":{}}
```

Successful response:

```json
{"id":"1","result":{"service":"CairnCodex.GrimDawn","protocolVersion":1,"mode":"read-only"}}
```

Error response:

```json
{"id":"1","error":{"code":"method_not_found","message":"Unknown method: example"}}
```

The protocol is versioned independently of either executable. Binary item data
will be base64 encoded at this boundary unless profiling demonstrates that a
separate binary transport is necessary.

## Process lanes and cache lifetime

The Electron client runs two protocol-identical helper processes with deliberately
different lifetimes:

- The live lane handles health checks, hook ownership, incoming polling, and live
  retrieval receipts. It remains at normal priority and never parses installed ARZ
  data, so a cold catalog request cannot delay a live transfer.
- The worker lane handles discovery, game-data projection, icons, stash operations,
  and offline analysis. It runs below normal priority, reuses parsed game data while
  requests remain active, and exits after 30 seconds idle. Process exit is the hard
  cache boundary and releases the expanded game-data graph back to Windows.

An in-flight request always suppresses idle eviction. A later worker request starts a
fresh process and retains the existing file-fingerprint invalidation rules. The
diagnostic-only `measure-memory` request reports process, working-set, private, and
managed-heap bytes for the installed-data performance gate; it does not inspect user
items or game memory.

## Read-only transfer-stash scan

```json
{"id":"2","method":"scan-transfer-stash","params":{"path":"C:\\path\\to\\transfer.gst"}}
```

The result includes the source path, size, SHA-256 hash, modification time,
stash version and mode, tabs, and every serialized item field currently known
to the imported GDIA parser. A scan is rejected if the file metadata changes
while it is being read.

## Grim Dawn discovery

```json
{"id":"3","method":"discover-grim-dawn","params":{}}
```

Discovery checks registered Steam libraries and GOG installations for a valid
`database/database.arz`, then checks the standard Documents and Steam Cloud save
roots. Transfer-stash candidates are parsed before they are returned. A broken
or unsupported candidate is reported with its own error instead of failing the
entire discovery operation.

## Game item catalog

~~~json
{"id":"4","method":"build-item-catalog","params":{"installationPath":"C:\\path\\to\\Grim Dawn"}}
~~~

The helper reads the base game and installed gdx1 through gdx9 archives in
ascending priority order. It overlays English tags and whole DBR records, then
returns collection-eligible Epic and Legendary gear with canonical record,
name, rarity, slot, levels, set relationship, bitmap reference, and content
pack. Formulae, enemy-only gear, sandbox records, and unresolved internal names
are excluded.

## Collection snapshot

~~~json
{"id":"5","method":"scan-collection","params":{}}
~~~

This is the desktop's read-only milestone endpoint. It combines discovery,
catalog parsing, and every validated transfer-stash scan. The result contains
the complete catalog, per-rarity totals, currently available counts, content
packs, source-stash hashes, and non-fatal source warnings. It does not yet
persist lifetime discovery; that becomes the SQLite layer's responsibility.

## Write-safety inspection and disposable self-test

~~~json
{"id":"6","method":"inspect-write-safety","params":{}}
{"id":"7","method":"self-test-write-transaction","params":{}}
~~~

Inspection reports the current closed-processes safety gate and any Grim Dawn
or IAGrim processes blocking permission. The self-test never touches Grim Dawn
data; it verifies backup, validation, stale-source rejection, atomic
replacement, rollback preservation, and final hashes in a uniquely named
temporary directory.

## Read-only serializer validation

~~~json
{"id":"8","method":"validate-transfer-stash-roundtrip","params":{"path":"C:\\path\\to\\transfer.gsh"}}
~~~

This method parses a stash, serializes it in memory with a zero cipher key,
reparses it, compares every known item/header/layout field, serializes it a
second time, and requires deterministic bytes. It never writes the source or a
replacement. Real-write IPC remains intentionally absent.

## In-memory ingest planning

~~~json
{"id":"9","method":"validate-ingest-plan","params":{"path":"C:\\path\\to\\transfer.gsh","tabIndex":0,"itemIndex":0}}
~~~

The planner captures every known field of the selected item as an app-owned
vault payload, removes it only from an in-memory stash, serializes and reparses
the proposed replacement, verifies that exactly one item was removed, compares
all remaining fields, and requires deterministic serialization. It returns
hashes and validation evidence, not a write capability.

Multi-item ingest uses `plan-ingest-items` with an ordered `items` array. Once
the desktop has durably persisted the payloads and a prepared journal entry,
`commit-ingest-items` repeats the plan, enforces the process safety gate and
source hash, creates durable backup and rollback files, and atomically commits
the validated bytes.

## Retrieval planning and commit

~~~json
{"id":"10","method":"plan-retrieve-items","params":{"path":"C:\\path\\to\\transfer.gsh","targetTabIndex":4,"items":[{"stashVersion":11,"baseRecord":"records/items/example.dbr","seed":123}]}}
~~~

The complete vault payloads are supplied by the Electron main process; the
helper never opens SQLite. The first retrieval milestone requires an empty
destination tab and an exact stash-version match. It reconstructs every known
item field and original coordinate, serializes and reparses the candidate,
compares each restored item, verifies the exact item-count increase, and
requires deterministic bytes.

`commit-retrieve-items` accepts the same plan plus an operation ID, expected
source hash and backup directory. It recomputes the plan and commits only
through the verified file transaction. `validate-ingest-retrieval-roundtrip`
removes and reconstructs a selected real item entirely in memory for smoke
coverage across every discovered non-empty stash version.

## Seed-applied roll analysis

~~~json
{"id":"11","method":"analyze-item-rolls","params":{"installationPath":"G:\\path\\to\\Grim Dawn","items":[{"baseRecord":"records/items/example.dbr","prefixRecord":"","suffixRecord":"","seed":123}]}}
~~~

The analyzer uses the pinned GDIA MINSTD stream and item-stat engine to replay
Grim Dawn's shared random draw order over the overlaid base/prefix/suffix DBR
records. It discards zero-valued template defaults exactly as GDIA's ARZ
projection does. If a nonzero rollable field is not modeled, the result is
marked untrusted and no score is produced.

For a trusted template, each rollable stat receives a deterministic empirical
percentile against 4,096 seeds distributed across the unsigned seed space. The
response exposes the sample size and sampled extrema; fixed fields have no
percentile. Min/max members of one displayed damage range are averaged as one
stat line before the overall arithmetic mean is calculated. This is an
auditable auto-best heuristic, not a claim that all stats have equal gameplay
value; pinned-best remains a separate user choice.
