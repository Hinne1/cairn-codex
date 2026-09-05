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
{"id":"1","result":{"service":"CairnCodex.GrimDawn","protocolVersion":1,"capabilities":["json-line-v1","live-lane-v1","worker-lane-v1"],"mode":"read-only"}}
```

Error response:

```json
{"id":"1","error":{"code":"method_not_found","message":"Unknown method: example"}}
```

The protocol is versioned independently of either executable. Binary item data
will be base64 encoded at this boundary unless profiling demonstrates that a
separate binary transport is necessary.

## Process generations and failure handling

Each live/worker process must complete one health handshake before any operational
request is sent. The service name, exact protocol version and required capability
flags are verified again after worker eviction or process exit. Capability flags
describe this transport contract; existing helper/hook/game fingerprint checks
remain authoritative for native-write permission.

`src/main/grim-dawn/helper-protocol.ts` explicitly classifies every method's lane
and side effects. A parity test covers the C# dispatch table. Windows-specific
implementations remain behind this boundary, preparing for #160.

The client validates JSON object envelopes, bounded decimal IDs and exactly one
success/error variant. C#'s null inactive branch is accepted, as is an explicitly
null success. A missing result is never success. Valid unknown/duplicate IDs are
ignored; malformed JSON, UTF-8 or envelopes fail the generation with a fixed error
without logging response contents. Helper stderr is drained without forwarding
raw payloads or personal paths. Correlated request diagnostics remain available.

Default per-lane limits are 64 admitted/pending requests, 32 MiB per request,
64 MiB aggregate serialized pending/admission data, and 256 MiB per response line
(including lines without a terminator). Fragment accumulation is also bounded.
The response budget permits catalog snapshots; these are hard safety ceilings,
not target payload sizes. Request deadlines default to 60 seconds and worker idle
eviction to 30 seconds. Waiting for the initial handshake is bounded separately
by the same deadline. Options permit tighter fixture limits.

`HelperRequestError` distinguishes protocol/transport errors and uncertain writes.
A read timeout can retire and replace a read-only generation. If any write remains
in flight, a timeout settles its caller but retains its request until a late reply
or exit. New writes are rejected while a timed-out write remains unresolved;
read-only recovery requests remain possible. Nothing is automatically replayed.
Late completion releases transport resources without reporting a second success;
journals and receipts decide the durable outcome.
If a read expires behind a write and never replies, completion of the final write
retires the generation so that the read cannot retain queue capacity indefinitely.

Malformed output or disposal closes stdin gracefully. A generation with an
outstanding write is never killed by the timeout/idle fallback, and a replacement
cannot overlap that retiring generation. A permanently stuck write therefore
leaves the lane unavailable pending explicit process recovery. For read-only
retirement, a two-second kill fallback is allowed. A retiring live generation keeps
its lane occupied until process exit, including after read timeouts, because its
native connection outlives individual requests. A disposed client cannot start
another process. IPC translation preserves uncertainty through wrapped causes
without exposing internal messages or offering an automatic retry.

`npm run test:helper-client` covers malformed output, capabilities, lane isolation,
queue/line limits, duplicate IDs, fragmented Unicode, exit, late completion and a
synthetic commit that outlives both its deadline and the old shutdown kill delay.

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

Roll model v9 exposes a compact category profile. Item stat lines are
classified as offense, retaliation, defense, or utility; pet-bonus lines remain
isolated in a conditional pet category. Typed ordinary damage produces separate
offense lanes (for example Fire and Lightning), while retaliation is kept out of
ordinary offense and scored in its own specialist lane. Universal offense such
as Offensive Ability and attack speed contributes to every typed lane on that
template. Elemental offense remains an umbrella lane; when
Fire, Cold, or Lightning lanes exist, Elemental rolls also contribute to each of
those lanes because percent Elemental bonuses apply their full value to all
three, while flat Elemental damage represents an equal three-way split. A
multi-damage item therefore retains each supported perspective instead of
guessing the player's build. Unknown future modeled fields fall back to utility
so a roll can never silently disappear from the profile.

Each variable stat exposes `qualityPercent = clamp(100 * (value - sampledMin) /
(sampledMax - sampledMin), 0, 100)`, separately from `estimatedPercentile`.
Fixed/untrusted stats have null quality. Each category's `qualityPercent` is the
arithmetic mean of these range-quality values, with min/max members normalized
individually and averaged as one stat group. A category always lies between its
weakest and strongest included group. All-max rolls receive 100% even for discrete
stats. For example, equally frequent 7/8/9 values give quality 0/50/100 while a 9
has percentile rank 83.33. The category's legacy `estimatedPercentile` remains an
average of marginal ranks for audit compatibility; it is not its displayed quality.

`combinationPercentile` ranks the category quality against averages of the same
range-quality calculation over the sampled seeds, preserving correlations and
grouping. `78% (98th)` means 78% average range quality and a 98th-percentile rank
for that average, not an average marginal percentile. Ranks count samples below the score plus
half of tied samples (midrank). Their complement is not the fraction that scored
as high or higher; for example, a maximum shared by 20% of samples ranks at the
90th percentile, not a 10% chance of matching it. It does not claim that the item suits
a particular build. For a Monster Infrequent, the comparison population is the
exact base/prefix/suffix template, so the score rates the values rolled by that
affix combination rather than whether the affixes themselves are desirable. The legacy
overall and base/prefix/suffix aggregates remain in the response for storage
compatibility, but the copy-comparison header presents the category profile
instead of the overall aggregate.
